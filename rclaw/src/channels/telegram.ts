import { Bot } from "grammy";
import type { TelegramConfig } from "../config.js";
import type { ChannelAdapter, MessageHandler } from "./types.js";

export class TelegramChannel implements ChannelAdapter {
  private bot: Bot;
  private lastChatId: number | null = null;

  constructor(
    private userId: string,
    config: TelegramConfig,
    private onMessage: MessageHandler,
  ) {
    this.bot = new Bot(config.botToken);

    this.bot.on("message:text", async (ctx) => {
      this.lastChatId = ctx.chat.id;
      const text = ctx.message.text;
      console.log(`[${this.userId}][telegram] Received: ${text.slice(0, 80)}`);

      // Show "typing..." immediately
      await ctx.replyWithChatAction("typing").catch(() => {});
      // Keep typing indicator alive every 4s while processing
      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction("typing").catch(() => {});
      }, 4000);

      this.onMessage(text, async (reply) => {
        clearInterval(typingInterval);
        await ctx.reply(reply, { parse_mode: "Markdown" }).catch(async () => {
          // Fallback without markdown if parsing fails
          await ctx.reply(reply);
        });
      });
    });

    this.bot.catch((err) => {
      console.error(`[${this.userId}][telegram] Bot error:`, err.message);
      // Retry on 409 conflict (stale polling session elsewhere)
      if (err.message?.includes("409")) {
        console.log(`[${this.userId}][telegram] Retrying in 5s...`);
        setTimeout(() => this.start(), 5000);
      }
    });
  }

  async start() {
    console.log(`[${this.userId}][telegram] Starting bot...`);
    // Clear any stale webhook/polling sessions
    await this.bot.api.deleteWebhook({ drop_pending_updates: true });
    this.bot
      .start({
        onStart: () => console.log(`[${this.userId}][telegram] Bot started.`),
      })
      .catch((err) => {
        console.error(`[${this.userId}][telegram] Polling error:`, err.message);
        console.log(`[${this.userId}][telegram] Retrying in 10s...`);
        setTimeout(() => this.start(), 10000);
      });
  }

  async stop() {
    await this.bot.stop();
  }

  async sendMessage(text: string) {
    if (!this.lastChatId) {
      throw new Error("No chat ID available — user hasn't messaged yet");
    }
    await this.bot.api.sendMessage(this.lastChatId, text);
  }
}
