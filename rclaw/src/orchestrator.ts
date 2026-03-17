import { z } from "zod";
import type { ChannelAdapter, MessageHandler } from "./channels/types.js";
import type { Config } from "./config.js";
import type { Scheduler } from "./tools/scheduler.js";

interface QueueItem {
  text: string;
  reply: (text: string) => Promise<void>;
}

interface StreamMessage {
  type?: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
}

export class Orchestrator {
  private queues = new Map<string, QueueItem[]>();
  private busy = new Map<string, boolean>();
  private channels = new Map<string, Map<string, ChannelAdapter>>();
  private sessionContinue = new Set<string>(); // track which users have an existing session
  private abortControllers = new Map<string, AbortController>();
  private scheduler: Scheduler | null = null;

  constructor(private config: Config) {}

  setScheduler(scheduler: Scheduler) {
    this.scheduler = scheduler;
  }

  registerChannel(userId: string, channelName: string, adapter: ChannelAdapter) {
    if (!this.channels.has(userId)) {
      this.channels.set(userId, new Map());
    }
    this.channels.get(userId)!.set(channelName, adapter);
  }

  getChannel(userId: string, channelName: string): ChannelAdapter | undefined {
    return this.channels.get(userId)?.get(channelName);
  }

  createMessageHandler(userId: string): MessageHandler {
    return (text: string, reply: (text: string) => Promise<void>) => {
      void this.routeMessage(userId, text, reply);
    };
  }

  async routeMessage(userId: string, text: string, reply: (text: string) => Promise<void>) {
    if (!this.queues.has(userId)) {
      this.queues.set(userId, []);
    }

    this.queues.get(userId)!.push({ text, reply });

    if (this.busy.get(userId)) {
      return;
    }
    this.busy.set(userId, true);

    try {
      while (this.queues.get(userId)!.length > 0) {
        const item = this.queues.get(userId)!.shift()!;
        try {
          const response = await this.processMessage(userId, item.text);
          if (response) {
            const chunks = chunkText(response, 4000);
            for (const chunk of chunks) {
              await item.reply(chunk);
            }
          }
        } catch (err) {
          console.error(`[${userId}] Error processing message:`, err);
          await item.reply("Sorry, I encountered an error. Please try again.").catch(() => {});
        }
      }
    } finally {
      this.busy.set(userId, false);
    }
  }

  private async processMessage(userId: string, text: string): Promise<string> {
    const userConfig = this.config.users[userId];
    if (!userConfig) {
      throw new Error(`Unknown user: ${userId}`);
    }

    const sdk = await import("@anthropic-ai/claude-code");
    const shouldContinue = this.sessionContinue.has(userId);

    console.log(`[${userId}] Processing message (continue: ${shouldContinue})...`);

    const abortController = new AbortController();
    this.abortControllers.set(userId, abortController);

    const stream = sdk.query({
      prompt: text,
      options: {
        model: userConfig.model,
        cwd: userConfig.workspace,
        pathToClaudeCodeExecutable: "/Users/rijul/.local/share/claude/versions/2.1.77",
        permissionMode: "bypassPermissions" as "default",
        continue: shouldContinue,
        abortController,
        // MCP tools disabled for now — SDK MCP server needs compatible CLI
        // mcpServers: { rclaw: mcpServer },
        stderr: (data: string) => {
          if (data.trim()) {
            console.error(`[${userId}][stderr] ${data.trim()}`);
          }
        },
      },
    });

    const textParts: string[] = [];

    for await (const event of stream) {
      const msg = event as StreamMessage;

      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) {
            textParts.push(block.text);
          }
        }
      }
    }

    // Mark that this user now has a session to continue
    this.sessionContinue.add(userId);

    return textParts.join("\n").trim();
  }

  private createMcpServer(sdk: typeof import("@anthropic-ai/claude-code"), userId: string) {
    const getChannel = (u: string, c: string) => this.getChannel(u, c);
    const getScheduler = () => this.scheduler;
    return sdk.createSdkMcpServer({
      name: "rclaw",
      version: "1.0.0",
      tools: [
        sdk.tool(
          "send_message",
          "Send a message to the user on a specific channel (telegram, whatsapp, or slack)",
          {
            channel: z.string().describe("Channel to send on: telegram, whatsapp, or slack"),
            text: z.string().describe("Message text to send"),
          },
          async ({ channel, text }) => {
            const adapter = getChannel(userId, channel);
            if (!adapter) {
              return {
                content: [{ type: "text" as const, text: `Channel "${channel}" not configured` }],
              };
            }
            try {
              await adapter.sendMessage(text);
              return { content: [{ type: "text" as const, text: `Message sent via ${channel}` }] };
            } catch (err) {
              return { content: [{ type: "text" as const, text: `Failed: ${String(err)}` }] };
            }
          },
        ),
        sdk.tool(
          "schedule_task",
          "Schedule a recurring task with cron syntax (minute hour dayOfMonth month dayOfWeek)",
          {
            cron: z.string().describe("Cron expression, e.g. '0 9 * * 1' for every Monday at 9am"),
            task: z.string().describe("Task description / prompt to execute"),
          },
          async ({ cron, task }) => {
            if (!getScheduler()) {
              return { content: [{ type: "text" as const, text: "Scheduler not available" }] };
            }
            const id = getScheduler()!.addTask(userId, cron, task);
            return {
              content: [
                { type: "text" as const, text: `Task scheduled (id: ${id}). Cron: ${cron}` },
              ],
            };
          },
        ),
        sdk.tool("list_tasks", "List all scheduled tasks for this user", {}, async () => {
          if (!getScheduler()) {
            return { content: [{ type: "text" as const, text: "Scheduler not available" }] };
          }
          const tasks = getScheduler()!.listTasks(userId);
          if (tasks.length === 0) {
            return { content: [{ type: "text" as const, text: "No scheduled tasks." }] };
          }
          const list = tasks.map((t) => `- [${t.id}] ${t.cron}: ${t.task}`).join("\n");
          return { content: [{ type: "text" as const, text: `Scheduled tasks:\n${list}` }] };
        }),
        sdk.tool(
          "remove_task",
          "Remove a scheduled task by ID",
          {
            taskId: z.string().describe("Task ID to remove"),
          },
          async ({ taskId }) => {
            if (!getScheduler()) {
              return { content: [{ type: "text" as const, text: "Scheduler not available" }] };
            }
            const removed = getScheduler()!.removeTask(userId, taskId);
            return {
              content: [
                {
                  type: "text" as const,
                  text: removed ? `Task ${taskId} removed.` : `Task ${taskId} not found.`,
                },
              ],
            };
          },
        ),
        sdk.tool(
          "phone_control",
          "Control phone actions (not yet implemented)",
          {
            action: z.string().describe("Action to perform"),
          },
          async () => {
            return {
              content: [{ type: "text" as const, text: "Phone control is not implemented yet." }],
            };
          },
        ),
      ],
    });
  }

  async shutdown() {
    console.log("Shutting down...");

    for (const [userId, controller] of this.abortControllers) {
      console.log(`[${userId}] Aborting session...`);
      controller.abort();
    }
    this.abortControllers.clear();

    for (const [, userChannels] of this.channels) {
      for (const [, adapter] of userChannels) {
        try {
          await adapter.stop();
        } catch {}
      }
    }

    if (this.scheduler) {
      this.scheduler.stop();
    }
  }
}

function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let breakIdx = remaining.lastIndexOf("\n", maxLen);
    if (breakIdx < maxLen * 0.5) {
      breakIdx = maxLen;
    }
    chunks.push(remaining.slice(0, breakIdx));
    remaining = remaining.slice(breakIdx).trimStart();
  }
  return chunks;
}
