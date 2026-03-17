import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import QRCode from "qrcode";
import type { Config } from "./config.js";

const latestQr = new Map<string, string>();

export function setQr(userId: string, qr: string) {
  latestQr.set(userId, qr);
}

export function startQrServer(config: Config) {
  const port = config.qrPort || 3847;
  const userIds = Object.keys(config.users);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      const rows = userIds
        .map((id) => {
          const hasQr = latestQr.has(id);
          const status = hasQr ? "🔲 QR Ready" : "⏳ Waiting...";
          return `<tr><td>${id}</td><td>${status}</td><td><a href="/qr/${id}">View QR</a></td></tr>`;
        })
        .join("");
      res.end(`<!DOCTYPE html><html><head><title>rclaw QR Pairing</title>
        <meta http-equiv="refresh" content="5">
        <style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px}
        table{width:100%;border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd;text-align:left}</style>
        </head><body><h1>rclaw — WhatsApp Pairing</h1>
        <table><tr><th>User</th><th>Status</th><th>Action</th></tr>${rows}</table></body></html>`);
      return;
    }

    const qrMatch = url.pathname.match(/^\/qr\/([^/]+)$/);
    if (qrMatch) {
      const userId = qrMatch[1];
      const qr = latestQr.get(userId);
      res.writeHead(200, { "Content-Type": "text/html" });

      if (!qr) {
        res.end(`<!DOCTYPE html><html><head><title>QR — ${userId}</title>
          <meta http-equiv="refresh" content="3">
          <style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px}</style>
          </head><body><h1>${userId}</h1><p>Waiting for QR code... (auto-refreshes)</p>
          <a href="/">← Back</a></body></html>`);
        return;
      }

      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 300 });
        res.end(`<!DOCTYPE html><html><head><title>QR — ${userId}</title>
          <meta http-equiv="refresh" content="15">
          <style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px;text-align:center}</style>
          </head><body><h1>Scan for ${userId}</h1>
          <img src="${dataUrl}" alt="QR Code"><br><br>
          <p>Open WhatsApp → Linked Devices → Scan</p>
          <a href="/">← Back</a></body></html>`);
      } catch {
        res.end(`<p>Error generating QR</p>`);
      }
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[qr-server] WhatsApp pairing UI: http://127.0.0.1:${port}`);
  });

  return server;
}
