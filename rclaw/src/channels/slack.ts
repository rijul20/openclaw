import { App } from "@slack/bolt";
import type { SlackConfig } from "../config.js";
import type { ChannelAdapter, MessageHandler } from "./types.js";

export class SlackChannel implements ChannelAdapter {
  private app: App;
  private lastChannel: string | null = null;
  private lastThreadTs: string | null = null;

  constructor(
    private userId: string,
    config: SlackConfig,
    private onMessage: MessageHandler,
  ) {
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
    });

    this.app.event("message", async ({ event, say }) => {
      const msg = event as unknown as Record<string, unknown>;
      if (msg.bot_id || !msg.text) {
        return;
      }

      this.lastChannel = (msg.channel as string) ?? null;
      this.lastThreadTs = (msg.ts as string) ?? null;
      const text = msg.text as string;

      console.log(`[${this.userId}][slack] Received: ${text.slice(0, 80)}`);

      this.onMessage(text, async (reply) => {
        await say({ text: reply, thread_ts: msg.ts as string });
      });
    });
  }

  async start() {
    console.log(`[${this.userId}][slack] Starting bot...`);
    await this.app.start();
    console.log(`[${this.userId}][slack] Bot started (socket mode).`);
  }

  async stop() {
    await this.app.stop();
  }

  async sendMessage(text: string) {
    if (!this.lastChannel) {
      throw new Error("No Slack channel available — user hasn't messaged yet");
    }
    await this.app.client.chat.postMessage({
      channel: this.lastChannel,
      text,
      thread_ts: this.lastThreadTs ?? undefined,
    });
  }
}
