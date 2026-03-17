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

  // Set up channels for each user
  for (const [userId, userConfig] of Object.entries(config.users)) {
    const handler = orchestrator.createMessageHandler(userId);
    const channels = userConfig.channels;

    if (channels.telegram && channels.telegram.botToken !== "YOUR_TELEGRAM_BOT_TOKEN") {
      const tg = new TelegramChannel(userId, channels.telegram, handler);
      orchestrator.registerChannel(userId, "telegram", tg);
      await tg.start();
    }

    if (channels.whatsapp) {
      const wa = new WhatsAppChannel(userId, channels.whatsapp, handler, (qr) => {
        setQr(userId, qr);
        console.log(
          `[${userId}][whatsapp] QR updated — visit http://127.0.0.1:${config.qrPort}/qr/${userId}`,
        );
      });
      orchestrator.registerChannel(userId, "whatsapp", wa);
      await wa.start();
    }

    if (channels.slack && channels.slack.botToken !== "xoxb-YOUR-SLACK-BOT-TOKEN") {
      const sl = new SlackChannel(userId, channels.slack, handler);
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
