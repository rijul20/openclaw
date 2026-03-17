import { mkdirSync } from "node:fs";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import type { WhatsAppConfig } from "../config.js";
import type { ChannelAdapter, MessageHandler } from "./types.js";

export class WhatsAppChannel implements ChannelAdapter {
  private sock: WASocket | null = null;
  private lastJid: string | null = null;
  private connected = false;

  constructor(
    private userId: string,
    private config: WhatsAppConfig,
    private onMessage: MessageHandler,
    private onQr?: (qr: string) => void,
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

    this.sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") {
        return;
      }

      for (const msg of messages) {
        if (msg.key.fromMe) {
          continue;
        }
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        if (!text) {
          continue;
        }

        const jid = msg.key.remoteJid;
        if (!jid) {
          continue;
        }
        this.lastJid = jid;

        console.log(`[${this.userId}][whatsapp] Received: ${text.slice(0, 80)}`);

        this.onMessage(text, async (reply) => {
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

  async sendMessage(text: string) {
    if (!this.sock || !this.lastJid) {
      throw new Error("No WhatsApp connection or chat available");
    }
    await this.sock.sendMessage(this.lastJid, { text });
  }
}
