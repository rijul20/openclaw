# rclaw v2 — Implementation Plan

## Context

v1 shipped: V2 sessions, OS sandbox, message batching, contact isolation, rate limiting, persona architecture, three-layer testing (82% behaviour baseline, 8/10 UAT). This plan adds critical infrastructure and UX improvements, organized by the four pillars.

## Decisions Log

All decisions made during planning discussion (2026-03-18).

---

## Pillar 1: Core Architecture

### 1.1 Circuit Breaker

**Priority:** Tier 1 | **Effort:** ~30 min

Stop retrying after repeated session failures. 3 failures in 60 seconds → cooldown.

- Add `Map<string, { failCount, firstFailTime }>` to orchestrator
- In `recoverSession` / `recoverContactSession`: increment counter
- If 3 failures within 60s: reply "I'm having technical issues. Give me a minute and try again."
- On next message after 60s cooldown: reset counter
- **Files:** `src/orchestrator.ts`

### 1.2 `<internal>` Tag Stripping

**Priority:** Tier 0 | **Effort:** ~15 min

Agent can use `<internal>` tags for private reasoning that gets stripped before the user sees the response.

- After getting response: `response.replace(/<internal>[\s\S]*?<\/internal>/g, "").trim()`
- Add directive to persona template: "You can use `<internal>` tags for thinking that won't be shown to the user"
- **Files:** `src/orchestrator.ts`, `personas/assistant/CLAUDE.md`

### 1.3 File Cleanup Cron

**Priority:** Tier 0 | **Effort:** ~15 min

Auto-delete files in `files/` older than 7 days.

- Walk `files/` dir, check `mtime`, delete if > 7 days
- Run on startup + daily via `setInterval(24h)`
- **Files:** `src/orchestrator.ts` or `src/tools/scheduler.ts`

### 1.4 Session Compaction Handling

**Priority:** Tier 2 | **Effort:** ~30 min

Handle context window overflow gracefully.

- In `consumeStream()`: detect `{ type: "system", subtype: "status", status: "compacting" }`
- Send progress message: "Organizing my thoughts..."
- **Files:** `src/orchestrator.ts`

---

## Pillar 2: Agent Behaviour

### 2.1 Two-Tier Memory (MEMORY.md + HISTORY.md)

**Priority:** Tier 2 | **Effort:** ~30 min

Structured memory system replacing flat files.

- `memory/MEMORY.md`: Working memory. Read every session. Key facts, preferences. Keep under 50 lines.
- `memory/HISTORY.md`: Journal. Append-only. Notable events, decisions, corrections.
- Personality designer pre-seeds MEMORY.md with owner info from design questions
- **Files:** `personas/assistant/CLAUDE.md`, `src/commands/design-personality.ts`

### 2.2 Progress Streaming (Personality-Driven)

**Priority:** Tier 2 | **Effort:** ~1 hour

Tool-aware progress messages during agent processing.

- New file: `~/.rclaw/agents/<user>/progress.txt` (format: `ToolName: message`)
- In `consumeStream()`: on `tool_progress` event, look up tool name in progress map
- Deduplicate (don't repeat same tool within 10s)
- Personality designer generates this file alongside fillers.txt
- **Files:** `src/orchestrator.ts`, `src/commands/design-personality.ts`

---

## Pillar 3: Channels

### Telegram

#### 3.1 Owner ID Whitelist

**Priority:** Tier 1 | **Effort:** ~15 min

Only allow messages from the owner's Telegram user ID. Unknown users silently ignored.

- Add `ownerId: number` to `TelegramConfig`
- `if (ctx.from?.id !== ownerId) return`
- **Files:** `src/config.ts`, `src/channels/telegram.ts`, `config.sample.json`

#### 3.2 File Handling

**Priority:** Tier 1 | **Effort:** ~1 hour

Download photos, documents, videos. Reject voice notes with message.

- `npm install @grammyjs/files`
- Handlers for `message:photo`, `message:document`, `message:video`
- Voice notes: "I can't process voice messages yet, please type it out"
- Save to `files/` with timestamp + type naming
- **Files:** `src/channels/telegram.ts`, `package.json`

#### 3.3 Reliability Plugins

**Priority:** Tier 1 | **Effort:** ~15 min

Handle Telegram rate limits and server errors.

- `npm install @grammyjs/auto-retry @grammyjs/transformer-throttler`
- `bot.api.config.use(autoRetry()); bot.api.config.use(apiThrottler());`
- **Files:** `src/channels/telegram.ts`, `package.json`

#### 3.4 Forwarded Message Detection (Telegram)

**Priority:** Tier 0 | **Effort:** ~5 min

- Check `ctx.message.forward_origin` → prepend `[Forwarded message]\n\n`
- **Files:** `src/channels/telegram.ts`

### WhatsApp

#### 3.5 Read Receipts

**Priority:** Tier 1 | **Effort:** ~5 min

Mark as read on receive (blue ticks before processing).

- `await this.sock!.readMessages([msg.key])` before `this.onMessage()`
- **Files:** `src/channels/whatsapp.ts`

#### 3.6 extractMessageContent + getContentType

**Priority:** Tier 0 | **Effort:** ~15 min

Replace manual extraction chain with Baileys helper.

- Import `getContentType` from Baileys
- Replace manual chain with switch on `getContentType(msg.message)`
- **Files:** `src/channels/whatsapp.ts`

#### 3.7 msgRetryCounterCache

**Priority:** Tier 0 | **Effort:** ~10 min

Track message retry attempts to prevent "Bad MAC" errors.

- `npm install node-cache`
- `const msgRetryCounterCache = new NodeCache()`
- Pass to socket config
- **Files:** `src/channels/whatsapp.ts`, `package.json`

#### 3.8 Logger silent → warn

**Priority:** Tier 0 | **Effort:** ~1 min

- `pino({ level: "silent" })` → `pino({ level: "warn" })`
- **Files:** `src/channels/whatsapp.ts`

#### 3.9 Exponential Backoff

**Priority:** Tier 0 | **Effort:** ~10 min

Replace fixed 3s retry with exponential backoff (1s → 2s → 4s → ... → 60s max).

- Track `reconnectAttempt` counter, `delay = Math.min(1000 * 2 ** attempt, 60000)`
- Reset to 0 on connection open
- **Files:** `src/channels/whatsapp.ts`

#### 3.10 Quoted Replies

**Priority:** Tier 2 | **Effort:** ~15 min

Include quoted text in prompt when user swipe-replies.

- Check `msg.message.extendedTextMessage.contextInfo.quotedMessage`
- Prepend `[Replying to: "quoted text"]\n\n` (cap at 2000 chars)
- **Files:** `src/channels/whatsapp.ts`

#### 3.11 Forwarded Message Detection (WhatsApp)

**Priority:** Tier 0 | **Effort:** ~5 min

- Check `contextInfo.isForwarded` → prepend `[Forwarded message]\n\n`
- **Files:** `src/channels/whatsapp.ts`

#### 3.12 Full Message Type Router

**Priority:** Tier 2 | **Effort:** ~30 min

Route all WhatsApp message types to text representations.

- Location → `[Location shared: lat, lng — "name"]`
- Contact (vCard) → `[Contact shared: name, phone]`
- Poll → `[Poll: "question" — Options: a, b, c]`
- Sticker → `[Sticker received]` only if sole content
- **Files:** `src/channels/whatsapp.ts`

#### 3.13 Media Sending + Rich Outbox

**Priority:** Tier 2 | **Effort:** ~1.5 hours

Agent can send files, locations, contacts, and reactions via outbox.

- Files: auto-detect type from extension (image vs document)
- Location: `{"type":"send","location":{"lat":...,"lng":...,"name":"..."}}`
- Contact: `{"type":"send","contact":{"name":"...","phone":"..."}}`
- Reaction: `{"type":"react","emoji":"👍","messageId":"..."}`
- **Files:** `src/channels/whatsapp.ts`, `src/outbox-watcher.ts`, `personas/assistant/CLAUDE.md`

#### 3.14 Pairing Code Auth

**Priority:** Tier 2 | **Effort:** ~15 min

Alternative to QR scanning for headless/remote servers.

- Add `pairingMode?: "qr" | "code"` to config
- If "code": `const code = await sock.requestPairingCode(ownerNumber)`
- **Files:** `src/config.ts`, `src/channels/whatsapp.ts`

---

## Pillar 4: Agent Capabilities

No new capabilities in v2. Capabilities planned for v3:

- C7: Document processing (smart PDF/doc routing)
- C8: Scheduled communications (cron briefings)
- C9: Browser control
- C10: Phone control
- C11: Calendar integration
- C12: Email integration

---

## Build Order

### Phase 0: Quick Fixes

| #   | Item                                   | Pillar   | Effort |
| --- | -------------------------------------- | -------- | ------ |
| 1   | 3.6 WhatsApp extractMessageContent     | Channels | 15 min |
| 2   | 3.7 WhatsApp msgRetryCounterCache      | Channels | 10 min |
| 3   | 3.8 WhatsApp logger → warn             | Channels | 1 min  |
| 4   | 3.9 WhatsApp exponential backoff       | Channels | 10 min |
| 5   | 3.4 + 3.11 Forwarded message detection | Channels | 10 min |
| 6   | 1.2 `<internal>` tag stripping         | Core     | 15 min |
| 7   | 1.3 File cleanup cron                  | Core     | 15 min |

### Phase A: Security + Reliability

| #   | Item                             | Pillar   | Effort |
| --- | -------------------------------- | -------- | ------ |
| 8   | 3.1 Telegram owner ID whitelist  | Channels | 15 min |
| 9   | 1.1 Circuit breaker              | Core     | 30 min |
| 10  | 3.3 Telegram reliability plugins | Channels | 15 min |
| 11  | 3.14 WhatsApp pairing code auth  | Channels | 15 min |

### Phase B: Messaging Parity

| #   | Item                                      | Pillar   | Effort    |
| --- | ----------------------------------------- | -------- | --------- |
| 12  | 3.5 WhatsApp read receipts                | Channels | 5 min     |
| 13  | 3.2 Telegram file handling                | Channels | 1 hour    |
| 14  | 3.12 WhatsApp full message type router    | Channels | 30 min    |
| 15  | 3.10 WhatsApp quoted replies              | Channels | 15 min    |
| 16  | 3.13 WhatsApp media sending + rich outbox | Channels | 1.5 hours |

### Phase C: Intelligence

| #   | Item                   | Pillar    | Effort |
| --- | ---------------------- | --------- | ------ |
| 17  | 2.2 Progress streaming | Behaviour | 1 hour |
| 18  | 1.4 Session compaction | Core      | 30 min |
| 19  | 2.1 Two-tier memory    | Behaviour | 30 min |

### Phase D: Testing

| #   | Item                                           | Pillar    |
| --- | ---------------------------------------------- | --------- |
| 20  | UAT tests for new features                     | All       |
| 21  | Channel-specific tests                         | Channels  |
| 22  | Update behaviour tests if directives changed   | Behaviour |
| 23  | Update persona template + personality designer | Behaviour |

---

## Explicitly NOT Building (v2)

| Feature                | Reason                                   | Pillar       |
| ---------------------- | ---------------------------------------- | ------------ |
| Shell denylist         | Already `disallowedTools: ["Bash"]`      | Core         |
| Container isolation    | OS sandbox sufficient                    | Core         |
| WhatsApp groups        | Separate product. Park for v3.           | Channels     |
| Evolution API          | Migration cost not justified             | Channels     |
| Agent swarm            | Claude Code Agent tool handles subagents | Core         |
| Multi-provider routing | Contradicts subscription-only constraint | Core         |
| Voice transcription    | High complexity, niche. Park for later.  | Capabilities |
| Manual /compact        | Auto-compact sufficient                  | Core         |
| Filler → edit pattern  | Edits don't trigger notifications        | Channels     |

---

## Verification

After each phase:

1. `npx tsc --noEmit` — type check
2. `npm test` — pipeline tests (50 tests)
3. `BEHAVIOUR=1 npm run test:behaviour` — persona directive validation (28 tests)
4. `UAT=1 npm run test:uat` — full pipeline with real Claude (10 tests)
5. Manual smoke test on live Telegram + WhatsApp
