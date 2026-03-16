/**
 * Local HTTP proxy that speaks the Anthropic Messages API protocol.
 *
 * Accepts POST /v1/messages with an Anthropic-format request body,
 * forwards the prompt to Claude Code via the Agent SDK, and streams
 * back Anthropic-format SSE events. This lets any OpenClaw version
 * (including stable releases without wrapStreamFn support) use Claude
 * Code as a provider by pointing baseUrl at this proxy.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PROXY_PORT = 18990;

let serverInstance: ReturnType<typeof createServer> | null = null;
let sdkModule: typeof import("@anthropic-ai/claude-agent-sdk") | null = null;

async function loadSdk() {
  if (!sdkModule) {
    sdkModule = await import("@anthropic-ai/claude-agent-sdk");
  }
  return sdkModule;
}

// Map Anthropic model IDs back to Claude Code SDK model names
function resolveModelName(model: string): string {
  if (model.includes("opus")) return "opus";
  if (model.includes("haiku")) return "haiku";
  return "sonnet";
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
 * Convert Anthropic messages array to a prompt string for the SDK.
 */
function messagesToPrompt(messages: Array<{ role: string; content: unknown }>): string {
  const parts: string[] = [];
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

/**
 * Handle a POST /v1/messages request.
 *
 * Reads the Anthropic-format body, calls Claude Code via the SDK,
 * and streams back SSE events in Anthropic format.
 */
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
  const prompt = messagesToPrompt(body.messages ?? []);

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
      systemPrompt,
    },
  });

  if (!isStreaming) {
    // Non-streaming: collect all text and return a single response
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const msg of q) {
      if (msg.type === "stream_event") {
        const event = msg.event;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
        }
      } else if (msg.type === "assistant") {
        if (msg.message.usage) {
          inputTokens = msg.message.usage.input_tokens ?? 0;
          outputTokens = msg.message.usage.output_tokens ?? 0;
        }
      }
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: `msg_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }],
        model: body.model ?? "sonnet",
        stop_reason: "end_turn",
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      }),
    );
    return;
  }

  // Streaming: forward SDK events as Anthropic SSE.
  // The SDK yields stream_event messages whose `.event` field is a raw
  // BetaRawMessageStreamEvent — already in Anthropic SSE format. We
  // forward them verbatim. The SDK events include message_start,
  // content_block_start/delta/stop, message_delta, and message_stop.
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
  // CORS for local dev
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

  // Health check
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", provider: "claude-code" }));
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
        // Already running (maybe from another gateway instance)
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
  serverInstance?.close();
  serverInstance = null;
}
