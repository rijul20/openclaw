/**
 * Local HTTP proxy that speaks the Anthropic Messages API protocol.
 *
 * Uses a persistent Claude Code session (v2 SDK API) to keep one
 * subprocess alive. Incoming Anthropic API requests are converted to
 * SDK send() calls, and the assistant response is synthesized back
 * into Anthropic SSE format.
 *
 * First request: ~5-8s (subprocess startup + API TTFB)
 * Subsequent requests: ~2-4s (just API TTFB)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PROXY_PORT = 18990;

let serverInstance: ReturnType<typeof createServer> | null = null;

type SdkModule = typeof import("@anthropic-ai/claude-agent-sdk");
let sdkModule: SdkModule | null = null;

// Persistent session state
let session: {
  handle: ReturnType<SdkModule["unstable_v2_createSession"]>;
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
 * Reuses the subprocess across requests. Recreates if model changes.
 */
async function getOrCreateSession(model: string) {
  if (session && session.model === model) {
    return session;
  }

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
    permissionMode: "plan",
  });

  console.error(`[claude-code-proxy] session created (model=${model})`);
  session = { handle, model };
  return session;
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Build a prompt string from the Anthropic Messages API request body.
 * Includes system prompt and all messages.
 */
function buildPrompt(body: {
  system?: string | Array<{ text?: string }>;
  messages?: Array<{ role: string; content: unknown }>;
}): string {
  const parts: string[] = [];

  // System prompt
  if (typeof body.system === "string") {
    parts.push(body.system);
  } else if (Array.isArray(body.system)) {
    const text = body.system.map((b) => b.text ?? "").join("\n");
    if (text) parts.push(text);
  }

  // Messages
  for (const msg of body.messages ?? []) {
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
    if (msg.role === "user") parts.push(`Human: ${text}`);
    else if (msg.role === "assistant") parts.push(`Assistant: ${text}`);
  }

  return parts.join("\n\n");
}

/**
 * Consume messages from the session stream until a `result` message.
 */
async function* consumeUntilResult(
  iter: AsyncGenerator<unknown, void>,
): AsyncGenerator<unknown, void> {
  while (true) {
    const { value, done } = await iter.next();
    if (done) break;
    if ((value as { type?: string }).type === "result") break;
    yield value;
  }
}

async function handleMessages(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse(await readBody(req));
  const isStreaming = body.stream === true;
  const modelName = resolveModelName(body.model ?? "sonnet");
  const prompt = buildPrompt(body);

  let sess: Awaited<ReturnType<typeof getOrCreateSession>>;
  try {
    sess = await getOrCreateSession(modelName);
  } catch (err) {
    console.error("[claude-code-proxy] session error:", err instanceof Error ? err.message : err);
    return sendError(res, 500, "Failed to create Claude Code session");
  }

  // Send message and consume response
  const iter = sess.handle.stream();
  await sess.handle.send(prompt);

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
    console.error("[claude-code-proxy] stream error:", err instanceof Error ? err.message : err);
    resetSession();
    return sendError(res, 500, "Claude Code session error");
  }

  const msgId = `msg_${Date.now()}`;
  const modelStr = (body.model as string) ?? "claude-sonnet-4-6";

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

  // Streaming: synthesize Anthropic SSE events
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

function sendError(res: ServerResponse, status: number, message: string) {
  if (!res.headersSent) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        type: "error",
        error: { type: "server_error", message },
      }),
    );
  }
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
      sendError(res, 500, message);
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
        console.error(`[claude-code-proxy] port ${PROXY_PORT} in use, assuming already running`);
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
