import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import type { WhatsAppConfig } from "../config.js";
import type { ChannelAdapter, WhatsAppMessageHandler } from "./types.js";

export class WhatsAppChannel implements ChannelAdapter {
  private sock: WASocket | null = null;
  private lastJid: string | null = null;
  private connected = false;

  constructor(
    private userId: string,
    private config: WhatsAppConfig,
    private onMessage: WhatsAppMessageHandler,
    private onQr?: (qr: string) => void,
    private filesDir?: string,
  ) {}

  async start() {
    console.log(`[${this.userId}][whatsapp] Starting...`);
    mkdirSync(this.config.authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: "silent" });

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      version,
      logger,
      printQRInTerminal: false,
      browser: ["rclaw", "server", "1.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && this.onQr) {
        this.onQr(qr);
      }

      if (connection === "close") {
        this.connected = false;
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          console.error(`[${this.userId}][whatsapp] Logged out. Re-pair needed.`);
        } else {
          console.log(`[${this.userId}][whatsapp] Disconnected (${statusCode}), reconnecting...`);
          setTimeout(() => this.start(), 3000);
        }
      }

      if (connection === "open") {
        this.connected = true;
        console.log(`[${this.userId}][whatsapp] Connected.`);
      }
    });

    this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") {
        return;
      }

      for (const msg of messages) {
        if (msg.key.fromMe) {
          continue;
        }

        const jid = msg.key.remoteJid;
        if (!jid) {
          continue;
        }
        this.lastJid = jid;

        // Extract text from various message types
        let text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
        const caption =
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          msg.message?.documentMessage?.caption ||
          "";

        // Handle media messages — download to workspace and tell the agent
        const mediaType =
          (msg.message?.imageMessage && "image") ||
          (msg.message?.videoMessage && "video") ||
          (msg.message?.audioMessage && "audio") ||
          (msg.message?.documentMessage && "document") ||
          null;

        if (mediaType && this.filesDir) {
          try {
            const buffer = await downloadMediaMessage(msg, "buffer", {});
            const ext = this.getFileExtension(msg, mediaType);
            const filename = `${Date.now()}-${mediaType}${ext}`;
            const filepath = join(this.filesDir, filename);
            mkdirSync(this.filesDir, { recursive: true });
            writeFileSync(filepath, buffer);

            const fileNote = `[File received: ${mediaType} saved at ${filepath}. Use the Read tool to open it.]`;
            text = caption ? `${caption}\n\n${fileNote}` : fileNote;
            console.log(`[${this.userId}][whatsapp] Saved ${mediaType}: ${filename}`);
          } catch (err) {
            console.error(`[${this.userId}][whatsapp] Failed to download media:`, err);
            if (caption) {
              text = caption;
            }
          }
        } else if (!text && caption) {
          text = caption;
        }

        if (!text) {
          continue;
        }

        console.log(`[${this.userId}][whatsapp] Received: ${text.slice(0, 80)}`);

        // Show "composing..." immediately
        await this.sock!.sendPresenceUpdate("composing", jid).catch(() => {});

        this.onMessage(jid, text, async (reply) => {
          await this.sock!.sendPresenceUpdate("paused", jid).catch(() => {});
          await this.sock!.sendMessage(jid, { text: reply });
        });
      }
    });
  }

  async stop() {
    this.sock?.end(undefined);
    this.sock = null;
    this.connected = false;
  }

  private getFileExtension(msg: { message?: Record<string, unknown> }, mediaType: string): string {
    if (mediaType === "document") {
      const docMsg = msg.message?.documentMessage as { fileName?: string } | undefined;
      if (docMsg?.fileName) {
        const dot = docMsg.fileName.lastIndexOf(".");
        if (dot >= 0) {
          return docMsg.fileName.slice(dot);
        }
      }
    }
    const defaults: Record<string, string> = {
      image: ".jpg",
      video: ".mp4",
      audio: ".ogg",
      document: ".bin",
    };
    return defaults[mediaType] ?? "";
  }

  async sendMessage(text: string) {
    if (!this.sock || !this.lastJid) {
      throw new Error("No WhatsApp connection or chat available");
    }
    await this.sock.sendMessage(this.lastJid, { text });
  }

  async sendToContact(to: string, text: string) {
    if (!this.sock) {
      throw new Error("WhatsApp not connected");
    }
    // Normalize phone number to WhatsApp JID format
    const jid = to.includes("@") ? to : `${to.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text });
  }
}
