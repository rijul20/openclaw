import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Orchestrator } from "./orchestrator.js";

/**
 * Tiny localhost-only HTTP API so agents can send messages via curl.
 * POST /send { "userId": "alice", "channel": "whatsapp", "to": "+91...", "text": "hi" }
 */
export function startApiServer(orchestrator: Orchestrator, port: number) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "POST" && req.url === "/send") {
      const body = await readBody(req);
      try {
        const { userId, channel, to, text, task } = JSON.parse(body);
        if (!channel || !text) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "channel and text required" }));
          return;
        }
        await orchestrator.sendToContact(userId, channel, to, text, task);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[api] Agent API: http://127.0.0.1:${port}`);
  });

  return server;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
  });
}
