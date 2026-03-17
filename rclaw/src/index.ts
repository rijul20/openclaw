import { startApiServer } from "./api-server.js";
import { SlackChannel } from "./channels/slack.js";
import { TelegramChannel } from "./channels/telegram.js";
import { WhatsAppChannel } from "./channels/whatsapp.js";
import { loadConfig } from "./config.js";
import { Orchestrator } from "./orchestrator.js";
import { startQrServer, setQr } from "./qr-server.js";
import { Scheduler } from "./tools/scheduler.js";

async function main() {
  console.log("rclaw — Multi-User AI Agent Orchestrator");
  console.log("=========================================\n");

  const config = loadConfig();
  const orchestrator = new Orchestrator(config);
  const scheduler = new Scheduler(config, orchestrator);
  orchestrator.setScheduler(scheduler);

  // Start QR server for WhatsApp pairing
  startQrServer(config);

  // Start agent API server (localhost only)
  startApiServer(orchestrator, 3848);

  // Set up channels for each user
  for (const [userId, userConfig] of Object.entries(config.users)) {
    const ownerHandler = orchestrator.createOwnerMessageHandler(userId);
    const channels = userConfig.channels;

    if (channels.telegram && channels.telegram.botToken !== "YOUR_TELEGRAM_BOT_TOKEN") {
      const tg = new TelegramChannel(userId, channels.telegram, ownerHandler);
      orchestrator.registerChannel(userId, "telegram", tg);
      await tg.start();
    }

    if (channels.whatsapp) {
      const path = await import("node:path");
      const filesDir = path.resolve(userConfig.workspace, "files");
      // WhatsApp uses a router that splits owner vs contact messages
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

    if (channels.slack && channels.slack.botToken !== "xoxb-YOUR-SLACK-BOT-TOKEN") {
      const sl = new SlackChannel(userId, channels.slack, ownerHandler);
      orchestrator.registerChannel(userId, "slack", sl);
      await sl.start();
    }

    console.log(`[${userId}] Channels initialized.\n`);
  }

  // Start scheduler
  scheduler.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await orchestrator.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("\nrclaw is running. Press Ctrl+C to stop.\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
