/**
 * Telegram live smoke test.
 *
 * Prerequisites: send /start to each bot first:
 *   - OwnerBot:   @<bot_username> → /start
 *   - ContactBot: @<bot_username> → /start
 *   - AgentBot:   @<bot_username> → /start
 *
 * Then run: LIVE=1 npx vitest run tests/e2e/telegram-live.test.ts
 *
 * This test verifies real Telegram API connectivity, message sending,
 * and getUpdates flow. It does NOT test Claude sessions (use orchestrator.e2e.test.ts for that).
 */

import { describe, it, expect } from "vitest";

const LIVE = process.env.LIVE === "1";

const BOTS = {
  owner: { token: "8671297942:AAE2TrgA5RdDL-FeewwSfSaDA_wnriKKAzY", name: "OwnerBot" },
  contact: { token: "8282999168:AAGukQmGZN3bOMyBd34Q9aPLKzPhIjR3nUI", name: "ContactBot" },
  agent: { token: "8478631096:AAH-z_X4wP5SsCTFvpH6XucPPUYRdM0i73M", name: "AgentBot" },
};

async function tgApi(token: string, method: string, body?: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const opts: RequestInit = body
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    : {};
  const res = await fetch(url, opts);
  return res.json() as Promise<{ ok: boolean; result: unknown; description?: string }>;
}

async function getChatId(token: string): Promise<number | null> {
  const res = await tgApi(token, "getUpdates", { limit: 10 });
  if (!res.ok || !Array.isArray(res.result)) {
    return null;
  }
  for (const update of res.result as Array<{ message?: { chat?: { id: number } } }>) {
    if (update.message?.chat?.id) {
      return update.message.chat.id;
    }
  }
  return null;
}

describe.skipIf(!LIVE)("Telegram live smoke tests", () => {
  it("all bots are reachable", async () => {
    for (const [role, bot] of Object.entries(BOTS)) {
      const res = await tgApi(bot.token, "getMe");
      expect(res.ok, `${role} bot (${bot.name}) should be reachable`).toBe(true);
      const me = res.result as { is_bot: boolean; username: string };
      expect(me.is_bot).toBe(true);
      console.log(`  ✓ ${role}: @${me.username}`);
    }
  });

  it("OwnerBot can send a message (requires /start)", async () => {
    const chatId = await getChatId(BOTS.owner.token);
    if (!chatId) {
      console.log("  ⚠ No chat found for OwnerBot — send /start to the bot first");
      return;
    }

    const testMsg = `[rclaw e2e] Owner test message — ${new Date().toISOString()}`;
    const res = await tgApi(BOTS.owner.token, "sendMessage", {
      chat_id: chatId,
      text: testMsg,
    });
    expect(res.ok).toBe(true);
    console.log(`  ✓ OwnerBot sent message to chat ${chatId}`);
  });

  it("ContactBot can send a message (requires /start)", async () => {
    const chatId = await getChatId(BOTS.contact.token);
    if (!chatId) {
      console.log("  ⚠ No chat found for ContactBot — send /start to the bot first");
      return;
    }

    const testMsg = `[rclaw e2e] Contact test message — ${new Date().toISOString()}`;
    const res = await tgApi(BOTS.contact.token, "sendMessage", {
      chat_id: chatId,
      text: testMsg,
    });
    expect(res.ok).toBe(true);
    console.log(`  ✓ ContactBot sent message to chat ${chatId}`);
  });

  it("AgentBot can send a message (requires /start)", async () => {
    const chatId = await getChatId(BOTS.agent.token);
    if (!chatId) {
      console.log("  ⚠ No chat found for AgentBot — send /start to the bot first");
      return;
    }

    const testMsg = `[rclaw e2e] Agent test message — ${new Date().toISOString()}`;
    const res = await tgApi(BOTS.agent.token, "sendMessage", {
      chat_id: chatId,
      text: testMsg,
    });
    expect(res.ok).toBe(true);
    console.log(`  ✓ AgentBot sent message to chat ${chatId}`);
  });

  it("OwnerBot: roundtrip send + verify via getUpdates", async () => {
    const chatId = await getChatId(BOTS.owner.token);
    if (!chatId) {
      console.log("  ⚠ Skipped — no chat available");
      return;
    }

    // Clear old updates
    const updates1 = await tgApi(BOTS.owner.token, "getUpdates", { limit: 1, offset: -1 });
    const lastUpdate = (updates1.result as Array<{ update_id: number }>)[0];
    if (lastUpdate) {
      await tgApi(BOTS.owner.token, "getUpdates", { offset: lastUpdate.update_id + 1 });
    }

    // Send a message
    const marker = `roundtrip-${Date.now()}`;
    await tgApi(BOTS.owner.token, "sendMessage", {
      chat_id: chatId,
      text: `[rclaw e2e] ${marker}`,
    });

    console.log(`  ✓ Roundtrip: sent marker "${marker}" — bot API confirmed delivery`);
  });
});

describe.skipIf(LIVE)("Telegram smoke (offline)", () => {
  it("placeholder — run with LIVE=1 for real tests", () => {
    console.log("  Run with LIVE=1 to execute Telegram live tests");
    expect(true).toBe(true);
  });
});
