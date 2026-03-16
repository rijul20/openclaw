import type { StreamFn } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  Context,
  SimpleStreamOptions,
  TextContent,
  ThinkingContent,
  Usage,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import {
  emptyPluginConfigSchema,
  type OpenClawPluginApi,
  type ProviderAuthContext,
} from "openclaw/plugin-sdk/core";
import { getProxyPort, startProxy } from "./proxy.js";

const PROVIDER_ID = "claude-code";

// Model ID → Claude Code SDK model name (used by wrapStreamFn path)
const MODEL_MAP: Record<string, string> = {
  "claude-sonnet-4-6": "sonnet",
  "claude-opus-4-6": "opus",
  "claude-haiku-4-5-20251001": "haiku",
};

const MODELS = [
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Claude Code)",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 16_384,
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Claude Code)",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 16_384,
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5 (Claude Code)",
    reasoning: false,
    contextWindow: 200_000,
    maxTokens: 8_192,
  },
];

// All built-in Claude Code tools to disable (dumb pipe mode)
const DISALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TodoRead",
  "TodoWrite",
  "NotebookRead",
  "NotebookEdit",
  "Agent",
  "AskUserQuestion",
];

/**
 * Convert OpenClaw Context messages into a prompt string for the Agent SDK.
 * System prompt is extracted separately for the SDK's systemPrompt option.
 */
function messagesToPrompt(context: Context): string {
  const parts: string[] = [];
  for (const msg of context.messages) {
    if (msg.role === "user") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((c): c is TextContent => c.type === "text")
              .map((c) => c.text)
              .join("\n");
      parts.push(`Human: ${text}`);
    } else if (msg.role === "assistant") {
      const text = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (text) {
        parts.push(`Assistant: ${text}`);
      }
    } else if (msg.role === "toolResult") {
      const text = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (text) {
        parts.push(`Tool (${msg.toolName}): ${text}`);
      }
    }
  }
  return parts.join("\n\n");
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function makePartial(model: { api: string; provider: string; id: string }): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

// Pre-load the SDK module so subsequent calls don't pay the import cost
let sdkPromise: Promise<typeof import("@anthropic-ai/claude-agent-sdk")> | null = null;
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import("@anthropic-ai/claude-agent-sdk");
  }
  return sdkPromise;
}

/**
 * Create a StreamFn that routes through Claude Code via the Agent SDK.
 *
 * Each call spawns a Claude Code subprocess. All Claude Code tools are
 * disabled so it acts as a pure reasoning engine — OpenClaw's own tools
 * handle actions.
 *
 * Returns async — the runner awaits the SDK subprocess startup before
 * consuming the stream, avoiding first-token timeout issues.
 */
function createClaudeCodeStreamFn(): StreamFn {
  return async (
    model: { api: string; provider: string; id: string },
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const stream = createAssistantMessageEventStream();
    const partial = makePartial(model);
    const sdkModelName = MODEL_MAP[model.id] ?? "sonnet";
    const prompt = messagesToPrompt(context);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: AsyncGenerator<any, void>;
    try {
      // Await the SDK import so subprocess startup happens before
      // the stream is returned to the consumer.
      const { query } = await loadSdk();

      q = query({
        prompt,
        options: {
          model: sdkModelName,
          disallowedTools: DISALLOWED_TOOLS,
          tools: [], // no tools at all
          includePartialMessages: true,
          maxTurns: 1, // single reasoning turn
          persistSession: false, // ephemeral, no disk state
          systemPrompt: context.systemPrompt,
        },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[claude-code-provider] setup error:", errMsg);
      const errPartial = makePartial(model);
      errPartial.stopReason = "error";
      errPartial.errorMessage = errMsg;
      stream.push({ type: "error", reason: "error", error: errPartial });
      return stream;
    }

    // Pump SDK events into the stream asynchronously.
    (async () => {
      try {
        stream.push({ type: "start", partial });

        let contentIndex = 0;
        let currentText = "";

        for await (const message of q) {
          if (message.type === "stream_event") {
            const event = message.event;

            if (event.type === "content_block_start") {
              if (event.content_block.type === "text") {
                partial.content.push({ type: "text", text: "" } as TextContent);
                contentIndex = partial.content.length - 1;
                currentText = "";
                stream.push({ type: "text_start", contentIndex, partial });
              } else if (event.content_block.type === "thinking") {
                partial.content.push({
                  type: "thinking",
                  thinking: "",
                } as ThinkingContent);
                contentIndex = partial.content.length - 1;
                stream.push({ type: "thinking_start", contentIndex, partial });
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                currentText += event.delta.text;
                const textBlock = partial.content[contentIndex] as TextContent;
                textBlock.text = currentText;
                stream.push({
                  type: "text_delta",
                  contentIndex,
                  delta: event.delta.text,
                  partial,
                });
              } else if (event.delta.type === "thinking_delta") {
                const block = partial.content[contentIndex] as ThinkingContent;
                block.thinking += event.delta.thinking;
                stream.push({
                  type: "thinking_delta",
                  contentIndex,
                  delta: event.delta.thinking,
                  partial,
                });
              }
            } else if (event.type === "content_block_stop") {
              const block = partial.content[contentIndex];
              if (block?.type === "text") {
                stream.push({
                  type: "text_end",
                  contentIndex,
                  content: (block as TextContent).text,
                  partial,
                });
              } else if (block?.type === "thinking") {
                stream.push({
                  type: "thinking_end",
                  contentIndex,
                  content: (block as ThinkingContent).thinking,
                  partial,
                });
              }
            } else if (event.type === "message_delta") {
              const delta = event.delta as unknown as Record<string, unknown>;
              if (delta.stop_reason === "end_turn" || delta.stop_reason === "stop") {
                partial.stopReason = "stop";
              } else if (delta.stop_reason === "max_tokens") {
                partial.stopReason = "length";
              } else if (delta.stop_reason === "tool_use") {
                partial.stopReason = "toolUse";
              }
              const deltaUsage = (event as unknown as Record<string, unknown>).usage as
                | Record<string, number>
                | undefined;
              if (deltaUsage) {
                partial.usage.output += deltaUsage.output_tokens ?? 0;
              }
            }
          } else if (message.type === "assistant") {
            const betaMsg = message.message;
            if (betaMsg.usage) {
              partial.usage.input = betaMsg.usage.input_tokens ?? 0;
              partial.usage.output = betaMsg.usage.output_tokens ?? 0;
              const cache = betaMsg.usage as unknown as Record<string, unknown>;
              partial.usage.cacheRead = (cache.cache_read_input_tokens as number) ?? 0;
              partial.usage.cacheWrite = (cache.cache_creation_input_tokens as number) ?? 0;
              partial.usage.totalTokens =
                partial.usage.input +
                partial.usage.output +
                partial.usage.cacheRead +
                partial.usage.cacheWrite;
            }
          }
        }

        stream.push({
          type: "done",
          reason: partial.stopReason === "length" ? "length" : "stop",
          message: partial,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[claude-code-provider] stream error:", errMsg);
        const errPartial = makePartial(model);
        errPartial.stopReason = "error";
        errPartial.errorMessage = errMsg;
        stream.push({ type: "error", reason: "error", error: errPartial });
      }
    })();

    return stream;
  };
}

const claudeCodePlugin = {
  id: "claude-code-provider",
  name: "Claude Code Provider",
  description: "Use Claude Code subscription as LLM backend — routes through the Claude Agent SDK",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "Claude Code",
      docsPath: "/providers/claude-code",
      envVars: [],
      auth: [
        {
          id: "local",
          label: "Claude Code (local)",
          hint: "Uses your local Claude Code installation and subscription",
          kind: "custom" as const,
          run: async (_ctx: ProviderAuthContext) => {
            try {
              await loadSdk();
            } catch {
              throw new Error(
                "Claude Code SDK not available. Install it with: npm install -g @anthropic-ai/claude-code",
              );
            }
            return {
              profiles: [
                {
                  profileId: "claude-code:default",
                  credential: {
                    type: "api_key" as const,
                    provider: PROVIDER_ID,
                    key: "claude-code-local",
                  },
                },
              ],
              defaultModel: `${PROVIDER_ID}/claude-sonnet-4-6`,
            };
          },
        },
      ],
      catalog: {
        order: "simple",
        run: async () => {
          // Start the local proxy so the Anthropic Messages API transport
          // can reach Claude Code. Non-fatal if it fails (e.g. in tests).
          try {
            await startProxy();
          } catch {
            // Proxy start failed — models still show in catalog,
            // but requests will fail until proxy is available.
          }
          return {
            provider: {
              baseUrl: `http://127.0.0.1:${getProxyPort()}`,
              apiKey: "claude-code-local",
              api: "anthropic-messages" as const,
              models: MODELS.map((m) => ({
                id: m.id,
                name: m.name,
                api: "anthropic-messages" as const,
                reasoning: m.reasoning,
                input: ["text" as const, "image" as const],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: m.contextWindow,
                maxTokens: m.maxTokens,
              })),
            },
          };
        },
      },
      wrapStreamFn: () => createClaudeCodeStreamFn(),
    });
  },
};

export default claudeCodePlugin;
