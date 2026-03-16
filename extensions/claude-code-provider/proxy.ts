/**
 * Local HTTP proxy that speaks the Anthropic Messages API protocol.
 *
 * Maintains a persistent Claude Code session (one subprocess) and routes
 * each incoming request through it. First request pays the subprocess
 * startup cost (~5-8s); subsequent requests only pay API TTFB (~2-4s).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PROXY_PORT = 18990;

let serverInstance: ReturnType<typeof createServer> | null = null;

type SdkModule = typeof import("@anthropic-ai/claude-agent-sdk");
let sdkModule: SdkModule | null = null;

// Persistent session state
let session: {
  sdk: SdkModule;
  handle: ReturnType<SdkModule["unstable_v2_createSession"]>;
  streamIter: AsyncGenerator<unknown, void> | null;
  model: string;
} | null = null;

async function loadSdk(): Promise<SdkModule> {
  if (!sdkModule) {
    sdkModule = await import("@anthropic-ai/claude-agent-sdk");
  }
  return sdkModule;
}

function resolveModelName(model: string): string {
  if (model.includes("opus")) return "opus";
  if (model.includes("haiku")) return "haiku";
  return "sonnet";
}

/**
 * Get or create a persistent Claude Code session.
 *
 * The session stays alive across requests. If the model changes, we close
 * the old session and create a new one.
 */
async function getOrCreateSession(model: string) {
  if (session && session.model === model) {
    return session;
  }

  // Close existing session if model changed
  if (session) {
    try {
      session.handle.close();
    } catch {
      // ignore
    }
    session = null;
  }

  const sdk = await loadSdk();
  const handle = sdk.unstable_v2_createSession({
    model,
    disallowedTools: [
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
    ],
    permissionMode: "plan", // no tool execution
  });

  // Start the stream iterator — it won't yield until send() is called
  const streamIter = handle.stream();

  console.error(`[claude-code-proxy] session created (model=${model})`);

  session = { sdk, handle, streamIter, model };
  return session;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function extractPromptText(
  messages: Array<{ role: string; content: unknown }>,
  systemPrompt?: string,
): string {
  const parts: string[] = [];
  if (systemPrompt) {
    parts.push(systemPrompt);
  }
  for (const msg of messages) {
    const text =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? (msg.content as Array<{ type: string; text?: string }>)
              .filter((b) => b.type === "text" && b.text)
              .map((b) => b.text)
              .join("\n")
          : "";
    if (!text) continue;
    if (msg.role === "user") {
      parts.push(`Human: ${text}`);
    } else if (msg.role === "assistant") {
      parts.push(`Assistant: ${text}`);
    }
  }
  return parts.join("\n\n");
}

async function handleMessages(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse(await readBody(req));
  const isStreaming = body.stream === true;
  const modelName = resolveModelName(body.model ?? "sonnet");
  const systemPrompt =
    typeof body.system === "string"
      ? body.system
      : Array.isArray(body.system)
        ? (body.system as Array<{ text?: string }>).map((b) => b.text ?? "").join("\n")
        : undefined;
  const prompt = extractPromptText(body.messages ?? [], systemPrompt);

  let sess: Awaited<ReturnType<typeof getOrCreateSession>>;
  try {
    sess = await getOrCreateSession(modelName);
  } catch (err) {
    // Session creation failed — fall back to one-shot query()
    console.error(
      "[claude-code-proxy] session creation failed, using one-shot:",
      err instanceof Error ? err.message : err,
    );
    return handleMessagesOneShot(body, prompt, modelName, isStreaming, res);
  }

  // Get a fresh stream iterator for this turn and send the message
  const iter = sess.handle.stream();
  await sess.handle.send(prompt);

  // Collect the assistant response from the session stream
  let assistantText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for await (const raw of consumeUntilResult(iter)) {
      const m = raw as {
        type: string;
        message?: {
          content?: Array<{ type: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      };
      if (m.type === "assistant" && m.message) {
        for (const block of m.message.content ?? []) {
          if (block.type === "text" && block.text) {
            assistantText += block.text;
          }
        }
        if (m.message.usage) {
          inputTokens = m.message.usage.input_tokens ?? 0;
          outputTokens = m.message.usage.output_tokens ?? 0;
        }
      }
    }
  } catch (err) {
    console.error("[claude-code-proxy] session error:", err instanceof Error ? err.message : err);
    resetSession();
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ type: "error", error: { type: "server_error", message: String(err) } }),
      );
    }
    return;
  }

  const msgId = `msg_${Date.now()}`;
  const modelStr = (body.model as string) ?? "sonnet";

  if (!isStreaming) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: msgId,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: assistantText }],
        model: modelStr,
        stop_reason: "end_turn",
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }),
    );
    return;
  }

  // Streaming: synthesize Anthropic SSE events from the collected response
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  function sendEvent(eventType: string, data: unknown) {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  sendEvent("message_start", {
    type: "message_start",
    message: {
      id: msgId,
      type: "message",
      role: "assistant",
      content: [],
      model: modelStr,
      stop_reason: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  });
  sendEvent("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  sendEvent("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: assistantText },
  });
  sendEvent("content_block_stop", { type: "content_block_stop", index: 0 });
  sendEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: outputTokens },
  });
  sendEvent("message_stop", { type: "message_stop" });
  res.end();
}

/**
 * Consume messages from the session stream until we hit a `result` message,
 * yielding all non-result messages (stream_event, assistant, etc.).
 */
async function* consumeUntilResult(
  iter: AsyncGenerator<unknown, void>,
): AsyncGenerator<unknown, void> {
  while (true) {
    const { value, done } = await iter.next();
    if (done) break;
    const m = value as { type?: string };
    if (m.type === "result") {
      // Turn complete
      break;
    }
    yield value;
  }
}

function resetSession() {
  if (session) {
    try {
      session.handle.close();
    } catch {
      // ignore
    }
    session = null;
  }
}

/**
 * Fallback: one-shot query() for when the persistent session fails.
 */
async function handleMessagesOneShot(
  body: Record<string, unknown>,
  prompt: string,
  modelName: string,
  isStreaming: boolean,
  res: ServerResponse,
) {
  const sdk = await loadSdk();
  const q = sdk.query({
    prompt,
    options: {
      model: modelName,
      tools: [],
      disallowedTools: [
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
      ],
      maxTurns: 1,
      persistSession: false,
      includePartialMessages: true,
      systemPrompt: typeof body.system === "string" ? body.system : undefined,
    },
  });

  if (!isStreaming) {
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const msg of q) {
      if (msg.type === "stream_event") {
        const event = msg.event;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
        }
      } else if (msg.type === "assistant" && msg.message.usage) {
        inputTokens = msg.message.usage.input_tokens ?? 0;
        outputTokens = msg.message.usage.output_tokens ?? 0;
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: `msg_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }],
        model: (body.model as string) ?? "sonnet",
        stop_reason: "end_turn",
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }),
    );
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  function sendEvent(eventType: string, data: unknown) {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  for await (const msg of q) {
    if (msg.type === "stream_event") {
      sendEvent(msg.event.type, msg.event);
    }
  }
  res.end();
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/v1/messages") {
    try {
      await handleMessages(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[claude-code-proxy] error:", message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            type: "error",
            error: { type: "server_error", message },
          }),
        );
      }
    }
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        provider: "claude-code",
        persistent_session: session !== null,
      }),
    );
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

export function getProxyPort(): number {
  return PROXY_PORT;
}

export async function startProxy(): Promise<void> {
  if (serverInstance) return;

  return new Promise((resolve, reject) => {
    const server = createServer(handleRequest);
    server.listen(PROXY_PORT, "127.0.0.1", () => {
      serverInstance = server;
      console.error(`[claude-code-proxy] listening on http://127.0.0.1:${PROXY_PORT}`);
      resolve();
    });
    server.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        console.error(
          `[claude-code-proxy] port ${PROXY_PORT} in use, assuming proxy is already running`,
        );
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

export function stopProxy(): void {
  resetSession();
  serverInstance?.close();
  serverInstance = null;
}
