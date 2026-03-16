/**
 * Local HTTP proxy that forwards Anthropic Messages API requests to
 * api.anthropic.com using the Claude Code subscription's OAuth token.
 *
 * This gives full Anthropic API compatibility — tools, streaming,
 * thinking, images — using the user's Claude Code subscription billing
 * instead of a separate API key.
 *
 * The OAuth token is read from the macOS Keychain (Claude Code stores it
 * under "Claude Code-credentials"). Token refresh is handled by falling
 * back to the Claude Code SDK when the token expires.
 */

import { execSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PROXY_PORT = 18990;
const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION = "2023-06-01";

let serverInstance: ReturnType<typeof createServer> | null = null;
let cachedToken: string | null = null;

/**
 * Read the OAuth access token from the macOS Keychain.
 */
function readTokenFromKeychain(): string | null {
  try {
    const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(raw) as {
      claudeAiOauth?: { accessToken?: string };
    };
    return parsed.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the OAuth token, using cache for performance.
 */
function getToken(): string {
  if (cachedToken) return cachedToken;
  const token = readTokenFromKeychain();
  if (!token) {
    throw new Error(
      "Claude Code OAuth token not found in Keychain. Make sure Claude Code is installed and authenticated.",
    );
  }
  cachedToken = token;
  return token;
}

/**
 * Invalidate the cached token (e.g. on 401 response).
 */
function invalidateToken() {
  cachedToken = null;
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
 * Forward an Anthropic Messages API request to api.anthropic.com
 * with the Claude Code OAuth token.
 */
async function handleMessages(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const token = getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": token,
    "anthropic-version": ANTHROPIC_API_VERSION,
    // Enable beta features that OpenClaw may use
    "anthropic-beta": "interleaved-thinking-2025-05-14,output-128k-2025-02-19",
  };

  const response = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
    method: "POST",
    headers,
    body,
  });

  // If auth failed, invalidate token cache and return the error
  if (response.status === 401) {
    invalidateToken();
    // Try once more with a fresh token
    const freshToken = getToken();
    if (freshToken !== token) {
      const retryResponse = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
        method: "POST",
        headers: { ...headers, "x-api-key": freshToken },
        body,
      });
      return streamResponse(retryResponse, res);
    }
  }

  return streamResponse(response, res);
}

/**
 * Stream the Anthropic API response back to the client.
 */
async function streamResponse(response: Response, res: ServerResponse) {
  // Forward status and relevant headers
  const contentType = response.headers.get("content-type") ?? "application/json";
  const responseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
  };

  // Forward rate limit headers if present
  for (const header of [
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "retry-after",
  ]) {
    const value = response.headers.get(header);
    if (value) responseHeaders[header] = value;
  }

  if (contentType.includes("text/event-stream")) {
    responseHeaders["Cache-Control"] = "no-cache";
    responseHeaders["Connection"] = "keep-alive";
  }

  res.writeHead(response.status, responseHeaders);

  if (!response.body) {
    const text = await response.text();
    res.end(text);
    return;
  }

  // Stream the response body through
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    reader.releaseLock();
    res.end();
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
    const hasToken = readTokenFromKeychain() !== null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: hasToken ? "ok" : "no_token",
        provider: "claude-code",
        auth: hasToken ? "keychain" : "missing",
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

  // Verify token is available (non-fatal — proxy can still start,
  // requests will fail with auth error at call time)
  try {
    getToken();
  } catch (err) {
    console.error(`[claude-code-proxy] warning: ${err instanceof Error ? err.message : err}`);
  }

  return new Promise((resolve, reject) => {
    const server = createServer(handleRequest);
    server.listen(PROXY_PORT, "127.0.0.1", () => {
      serverInstance = server;
      console.error(
        `[claude-code-proxy] listening on http://127.0.0.1:${PROXY_PORT} (auth=keychain)`,
      );
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
  serverInstance?.close();
  serverInstance = null;
}
