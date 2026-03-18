# Channel Architecture

Channel-specific nuances, quirks, limitations, and implementation decisions.

---

## Telegram

**Implementation:** `src/channels/telegram.ts` (grammy)

### How it works

- Bot polls for messages via long polling (not webhooks)
- Owner-only channel — all messages go to the owner session
- No contact routing (Telegram bots are 1:1 private chats)

### Quirks

- **409 conflict:** If another polling session exists (e.g., old process), grammy throws 409. We auto-retry after 5s.
- **Typing indicator:** 5s TTL, we refresh every 4s to keep it alive during processing.
- **Markdown fallback:** Send with `parse_mode: Markdown`, fallback to plain text if parsing fails (Telegram is strict about Markdown).
- **Stale webhook:** On start, we call `deleteWebhook({ drop_pending_updates: true })` to clear stale sessions.

### Limitations

| Capability      | Status                                                           |
| --------------- | ---------------------------------------------------------------- |
| Owner routing   | By Telegram chat ID (whoever /start'd the bot)                   |
| Contact routing | Not supported — 1:1 bot model                                    |
| File receive    | 20 MB limit (Bot API)                                            |
| File send       | Via sendDocument/sendPhoto                                       |
| Message editing | Supported (could update filler → real response, not implemented) |
| Read receipts   | Not available via Bot API                                        |

---

## WhatsApp

**Implementation:** `src/channels/whatsapp.ts` (Baileys)

### How it works

- Connects as a linked device (like WhatsApp Web)
- Owner vs contact routing by phone number (`ownerNumber` in config)
- Media download + save to workspace for agent processing

### Quirks

- **LID routing (critical):** WhatsApp now uses Linked Device IDs (`42752154816614@lid`) as `remoteJid` instead of phone numbers. Real phone is in `msg.key.senderPn`. We use `senderPn` for routing, `remoteJid` for replies.
- **QR pairing:** On first connect, Baileys generates QR codes. We serve them via `src/qr-server.ts` at `http://127.0.0.1:{qrPort}/qr/{userId}`.
- **Reconnect:** On disconnect (non-logout), auto-reconnect after 3s. On logout, require re-pair.
- **E2E encryption sync:** After re-pairing, the phone may show "Waiting for this message" on messages sent by Baileys. Fix: delete `whatsapp-auth/` and re-pair fresh.
- **Signal key store:** Baileys uses `makeCacheableSignalKeyStore` for performance. Auth files in `authDir`.
- **Composing presence:** Show "composing..." immediately on message receive, "paused" after reply.

### Limitations

| Capability      | Status                                       |
| --------------- | -------------------------------------------- |
| Owner routing   | By phone number (senderPn vs ownerNumber)    |
| Contact routing | By phone number — non-owner = contact        |
| File receive    | No practical limit                           |
| File send       | Not implemented (outbox is text-only)        |
| Message editing | Not supported by WhatsApp                    |
| Read receipts   | Available (blue ticks) but not used by rclaw |
| Groups          | Not supported — only 1:1 chats               |

---

## Slack

**Implementation:** `src/channels/slack.ts` (@slack/bolt)

### How it works

- Socket mode (no public URL needed)
- Owner-only — ignores bot messages
- Threads supported (replies go to thread if original was in thread)

### Quirks

- **Bot message filtering:** Checks `bot_id` to ignore own messages.
- **Thread tracking:** Tracks `lastThreadTs` so replies stay in thread context.

### Limitations

| Capability       | Status                           |
| ---------------- | -------------------------------- |
| Owner routing    | All messages go to owner session |
| Contact routing  | Not supported                    |
| File receive     | Not implemented                  |
| Typing indicator | Not implemented                  |
| Filler messages  | Not implemented (no sendFiller)  |

---

## Channel Adapter Interface

All channels implement `ChannelAdapter` from `src/channels/types.ts`:

```typescript
interface ChannelAdapter {
  channelName: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(text: string): Promise<void>;
  sendToContact?(to: string, text: string): Promise<void>;
  sendFiller?(text: string): Promise<void>;
}
```

### Adding a new channel

1. Implement `ChannelAdapter` in `src/channels/<name>.ts`
2. Register in `src/index.ts` startup loop
3. Add config type in `src/config.ts`
4. Add tests in `tests/channels/`
5. Document in this file

---

## Testing

Channel tests live in `tests/channels/` (planned) and `tests/e2e/`:

- `tests/e2e/telegram-live.test.ts` — bot connectivity + message send (`LIVE=1`)
- `tests/e2e/live-roundtrip.test.ts` — 3-bot roundtrip test (`LIVE=1`)
- Channel-specific unit tests: not yet written
