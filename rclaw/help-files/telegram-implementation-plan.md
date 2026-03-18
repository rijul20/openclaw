# Telegram Implementation Plan

Current state: basic text-only handler using grammY. Works for chat, but missing file handling, reliability plugins, and structured handler organization.

## Priority 1: File Downloads (media parity with WhatsApp)

Currently only `message:text` is handled. Need to receive and process all media types.

### Install files plugin

```typescript
import { hydrateFiles } from "@grammyjs/files";
bot.api.config.use(hydrateFiles(bot.token));
```

### Handle all message types

- `message:photo` — download to workspace, tell agent (same pattern as WhatsApp)
- `message:document` — PDFs, spreadsheets, text files
- `message:video` — save to workspace
- `message:audio` + `message:voice` — voice notes and audio files
- `message:video_note` — circular video messages
- `message:sticker` — probably ignore, but log
- `message:location` — extract coordinates, pass as text
- `message:contact` — extract phone number + name, pass as text

### File download pattern

```typescript
bot.on("message:photo", async (ctx) => {
  const file = await ctx.getFile();
  const filepath = join(filesDir, `${Date.now()}-photo.jpg`);
  await file.download(filepath); // requires hydrateFiles plugin
  const caption = ctx.message.caption || "";
  const text = `${caption}\n\n[Photo received, saved at ${filepath}. Use the Read tool to view it.]`;
  onMessage(text, replyFn);
});

// Similar for document, video, audio, voice
```

### File size limits (Bot API)

- Download: 20 MB max
- Upload: 50 MB max
- For files >20 MB: tell agent the file is too large, suggest WhatsApp or manual transfer

## Priority 2: Reliability Plugins

### Auto-retry (replaces manual 409 handling)

```typescript
import { autoRetry } from "@grammyjs/auto-retry";
bot.api.config.use(autoRetry());
```

Handles 429 (rate limit), 5xx errors, respects `retry_after`. Removes need for our manual 409 retry logic in `bot.catch()`.

### Throttler (prevent hitting Telegram rate limits)

```typescript
import { apiThrottler } from "@grammyjs/transformer-throttler";
bot.api.config.use(apiThrottler());
```

Enforces Telegram's limits: 30 msgs/sec to same chat, 150 msgs/sec total.

## Priority 3: Refactor Handler Organization

Current: everything in one `bot.on("message:text")` handler inside the constructor.

### Proposed structure

Split handlers by message type, use middleware for shared logic:

```typescript
// Middleware: typing indicator for ALL message types
bot.use(async (ctx, next) => {
  await ctx.replyWithChatAction("typing").catch(() => {});
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 4000);
  ctx.api.config.use((prev, method, payload) => {
    // Clear typing when we send a response
    if (method === "sendMessage") clearInterval(typingInterval);
    return prev(method, payload);
  });
  await next();
});

// Then individual handlers
bot.on("message:text", handleText);
bot.on("message:photo", handlePhoto);
bot.on("message:document", handleDocument);
bot.on("message:video", handleVideo);
bot.on("message:audio", handleAudio);
bot.on("message:voice", handleVoice);
bot.on("message:contact", handleContact);
bot.on("message:location", handleLocation);
```

## Priority 4: Inline Keyboards & Buttons

Useful for:

- Confirmation dialogs ("Send this message to Elina? [Yes] [No]")
- Quick actions ("What do you want to do? [Schedule] [Research] [Message someone]")
- Contact selection from a list

### Pattern

```typescript
import { InlineKeyboard } from "grammy";

const keyboard = new InlineKeyboard()
  .text("Yes, send it", "confirm_send")
  .text("No, cancel", "cancel_send");

await ctx.reply("Send this to Elina?", { reply_markup: keyboard });

bot.callbackQuery("confirm_send", async (ctx) => {
  await ctx.answerCallbackQuery("Sending...");
  // trigger the send
});
```

## Priority 5: Caption Handling

Messages with media often have captions. Need to extract and include:

```typescript
const caption = ctx.message.caption || "";
// Include caption as context alongside the file notification
```

## Priority 6: Message Editing & Deletion

Telegram supports editing sent messages. Useful for:

- Updating "Working on it..." filler with the actual response (cleaner UX than separate messages)
- Correcting responses

```typescript
const filler = await ctx.reply("Working on it...");
// ... process ...
await ctx.api.editMessageText(ctx.chat.id, filler.message_id, actualResponse);
```

## Priority 7: Reply Threading

When the agent responds, quote the original message for clarity (especially in group chats or after delays):

```typescript
await ctx.reply(response, { reply_to_message_id: ctx.message.message_id });
```

## ~~Priority 8: Conversation Plugin~~ — DROPPED

**Dropped per critical analysis.** The agent owns all conversation state via its Claude session. Adding grammY's conversation plugin would create two competing state machines. grammY is a dumb transport pipe — nothing more.

## Priority 9: Forwarded Message Handling

Users often forward messages to the bot for context. Need to detect and include forwarding info:

```typescript
if (ctx.message.forward_from || ctx.message.forward_from_chat) {
  const forwardInfo = ctx.message.forward_from
    ? `Forwarded from: ${ctx.message.forward_from.first_name}`
    : `Forwarded from chat: ${ctx.message.forward_from_chat?.title}`;
  text = `${forwardInfo}\n\n${text}`;
}
```

## ~~Priority 10: Parse Mode HTML~~ — DROPPED

**Dropped per critical analysis.** HTML parse mode breaks with unescaped `<`, `>`, `&` in AI output. Keep current approach: try Markdown, fall back to plain text. More robust with unpredictable agent output.

## Priority 10: Owner ID Whitelist

Only allow the owner's Telegram user ID to interact with the bot. Reject all others silently.

```typescript
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ownerTelegramId) {
    return; // silently ignore
  }
  await next();
});
```

Config addition: `"telegram": { "botToken": "...", "ownerId": 123456789 }`

To find your Telegram user ID: message @userinfobot on Telegram.

## Priority 11: File Sending

Agent can receive files but not send them. Add to channel adapter:

```typescript
async sendFile(filepath: string) {
  if (!this.lastChatId) return;
  const ext = path.extname(filepath).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif"].includes(ext)) {
    await this.bot.api.sendPhoto(this.lastChatId, new InputFile(filepath));
  } else {
    await this.bot.api.sendDocument(this.lastChatId, new InputFile(filepath));
  }
}
```

## Priority 12: File Cleanup Cron

Delete files older than 7 days from `files/` directory. Run daily.

```typescript
// In scheduler or as a standalone setInterval
function cleanupOldFiles(filesDir: string, maxAgeDays = 7) {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  for (const file of readdirSync(filesDir)) {
    const stat = statSync(join(filesDir, file));
    if (stat.mtimeMs < cutoff) unlinkSync(join(filesDir, file));
  }
}
```

## Not Needed

- **Telethon/Pyrogram (MTProto)** — user-account level access, violates ToS for bot use
- **Webhooks** — long polling is simpler, no public URL needed, works fine for our scale
- **python-telegram-bot** — we're TypeScript, grammY covers everything
- **Custom session storage** — agent's workspace IS the session, no need for Redis/DB

## Dependencies to Add

```json
{
  "@grammyjs/files": "^x.x.x",
  "@grammyjs/auto-retry": "^x.x.x",
  "@grammyjs/transformer-throttler": "^x.x.x"
}
```

Note: `@grammyjs/parse-mode` dropped (staying with Markdown + fallback).

## Reference

- grammY docs: https://grammy.dev
- grammY plugins: https://grammy.dev/plugins/
- bot-base template (project structure reference): https://github.com/bot-base/telegram-bot-template
- Bot API file limits: 20 MB download, 50 MB upload
