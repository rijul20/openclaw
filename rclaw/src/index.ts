import { join } from "node:path";
import { SlackChannel } from "./channels/slack.js";
import { TelegramChannel } from "./channels/telegram.js";
import { WhatsAppChannel } from "./channels/whatsapp.js";
import { loadConfig } from "./config.js";
import { Orchestrator } from "./orchestrator.js";
import { startOutboxWatcher } from "./outbox-watcher.js";
import { startQrServer, setQr } from "./qr-server.js";
import { Scheduler } from "./tools/scheduler.js";

async function main() {
  console.log("rclaw v1 — Multi-User AI Agent Orchestrator");
  console.log("=============================================\n");

  const config = loadConfig();
  const orchestrator = new Orchestrator(config);
  const scheduler = new Scheduler(config, orchestrator);
  orchestrator.setScheduler(scheduler);

  // Start QR server for WhatsApp pairing
  startQrServer(config);

  // Initialize owner sessions sequentially (CWD mutex)
  for (const userId of Object.keys(config.users)) {
    try {
      await orchestrator.initOwnerSession(userId);
    } catch (err) {
      console.error(`[${userId}] Failed to init owner session:`, err);
    }
  }

  // Set up channels + outbox watchers for each user
  const outboxCleanups: (() => void)[] = [];

  for (const [userId, userConfig] of Object.entries(config.users)) {
    const ownerHandler = orchestrator.createOwnerMessageHandler(userId);
    const channels = userConfig.channels;

    // Telegram
    if (channels.telegram && channels.telegram.botToken !== "YOUR_TELEGRAM_BOT_TOKEN") {
      const tg = new TelegramChannel(userId, channels.telegram, ownerHandler);
      orchestrator.registerChannel(userId, "telegram", tg);
      await tg.start();
    }

    // WhatsApp
    if (channels.whatsapp) {
      const path = await import("node:path");
      const filesDir = path.resolve(userConfig.workspace, "files");
      const waRouter = orchestrator.createWhatsAppRouter(userId);
      const wa = new WhatsAppChannel(
        userId,
        channels.whatsapp,
        waRouter,
        (qr) => {
          setQr(userId, qr);
          console.log(
            `[${userId}][whatsapp] QR updated — visit http://127.0.0.1:${config.qrPort}/qr/${userId}`,
          );
        },
        filesDir,
      );
      orchestrator.registerChannel(userId, "whatsapp", wa);
      await wa.start();
    }

    // Slack
    if (channels.slack && channels.slack.botToken !== "xoxb-YOUR-SLACK-BOT-TOKEN") {
      const sl = new SlackChannel(userId, channels.slack, ownerHandler);
      orchestrator.registerChannel(userId, "slack", sl);
      await sl.start();
    }

    // Outbox watcher per user
    const outboxDir = join(userConfig.workspace, "outbox");
    const cleanup = startOutboxWatcher(
      outboxDir,
      async (payload) => {
        const channel = payload.channel || "whatsapp";
        await orchestrator.sendToContact(userId, channel, payload.to, payload.text, payload.task);
      },
      async (payload) => {
        // Reply payloads are routed back through the owner session
        console.log(`[${userId}][outbox] Reply to ${payload.phone}: ${payload.text.slice(0, 60)}`);
      },
    );
    outboxCleanups.push(cleanup);

    console.log(`[${userId}] Channels + outbox initialized.\n`);
  }

  // Start scheduler
  scheduler.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    for (const cleanup of outboxCleanups) {
      cleanup();
    }
    await orchestrator.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("\nrclaw v1 is running. Press Ctrl+C to stop.\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
