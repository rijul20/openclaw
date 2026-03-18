# rclaw v2 — Implementation Plan

## Context

v1 is running: V2 sessions, OS sandbox, message batching, contact isolation, rate limiting, persona architecture, behaviour testing (82% baseline). This plan adds critical infrastructure and UX improvements.

## Decisions Log

All decisions made during planning discussion (2026-03-18).

---

## Tier 1: Critical Infrastructure (~2.5 hours)

### 1. Telegram Owner ID Whitelist

**Decision:** Silent ignore for unknown users.

**What:** Only allow messages from the owner's Telegram user ID. Unknown users silently ignored — no rejection message.

**Implementation:**

- Add `ownerId: number` to `TelegramConfig` in `config.ts`
- In `telegram.ts` handler: `if (ctx.from?.id !== ownerId) return`
- Config: `"telegram": { "botToken": "...", "ownerId": 8538324436 }`

**Files:** `src/config.ts`, `src/channels/telegram.ts`, `config.sample.json`

---

### 2. WhatsApp Read Receipts

**Decision:** Mark as read on receive (before processing).

**What:** Send blue ticks immediately when message is received, before the agent starts processing.

**Implementation:**

- In WhatsApp `messages.upsert` handler, after extracting text:
  `await this.sock!.readMessages([msg.key])`
- One line, before `this.onMessage()` call

**Files:** `src/channels/whatsapp.ts`

---

### 3. Telegram File Handling

**Decision:** Parity with WhatsApp. Reject voice notes with message "I can't process voice messages yet, please type it out." Voice transcription saved for later version.

**What:** Download photos, documents, videos from Telegram. Save to `files/`, tell agent the path.

**Implementation:**

- `npm install @grammyjs/files`
- Add `bot.api.config.use(hydrateFiles(bot.token))` in constructor
- Add handlers for `message:photo`, `message:document`, `message:video`
- Download via `await ctx.getFile()` then fetch URL
- Check file size < 20MB (Telegram Bot API limit), reject if over
- Voice notes (`message:voice`): reply "I can't process voice messages yet, please type it out"
- Save to `files/` with timestamp + type naming (same as WhatsApp)
- Tell agent: `[File received: photo saved at /path. Use the Read tool to open it.]`

**Files:** `src/channels/telegram.ts`, `package.json`

**Future:** Voice transcription via Whisper for voice notes

---

### 4. Circuit Breaker

**Decision:** 3 failures / 60 seconds, generic error message, cooldown until next message.

**What:** Stop retrying after repeated session failures. Notify user once, wait for cooldown.

**Implementation:**

- Add to orchestrator: `Map<string, { failCount: number, firstFailTime: number }>`
- In `recoverSession` / `recoverContactSession`: increment counter
- If 3 failures within 60s: set cooldown flag, reply "I'm having technical issues. Give me a minute and try again."
- On next message after 60s cooldown: reset counter, try normally
- Log circuit breaker trips: `[alice] Circuit breaker tripped — 3 failures in 60s`

**Files:** `src/orchestrator.ts`

---

### 5. Telegram Reliability Plugins

**Decision:** Add autoRetry + apiThrottler. No config needed.

**What:** Handle Telegram rate limits and server errors gracefully.

**Implementation:**

- `npm install @grammyjs/auto-retry @grammyjs/transformer-throttler`
- In `telegram.ts` constructor:
  ```typescript
  bot.api.config.use(autoRetry());
  bot.api.config.use(apiThrottler());
  ```

**Files:** `src/channels/telegram.ts`, `package.json`

---

## Tier 2: UX & Messaging Improvements (~5.5 hours)

### 6. WhatsApp Quoted Replies

**Decision:** 2000 character cap on quoted text.

**What:** When user swipe-replies to a message, include the quoted text in the prompt.

**Implementation:**

- In WhatsApp handler: check `msg.message.extendedTextMessage.contextInfo.quotedMessage`
- Extract quoted text, cap at 2000 chars
- Prepend: `[Replying to: "quoted text"]\n\nUser's message`

**Files:** `src/channels/whatsapp.ts`

---

### 7. WhatsApp Media Sending

**Decision:** Auto-detect file type from extension.

**What:** Agent can send images and documents back via WhatsApp.

**Implementation:**

- Add `sendFile(to, filePath, caption?)` to WhatsApp adapter
- Outbox JSON gains optional `file` field: `{"type":"send","to":"+91...","text":"caption","file":"/path/to/file.pdf","channel":"whatsapp"}`
- Outbox watcher checks for `file` field, calls `sendFile`
- Auto-detect: `.jpg/.jpeg/.png/.gif/.webp` → `sendMessage(jid, { image: { url }, caption })`
- Everything else → `sendMessage(jid, { document: { url }, fileName, caption })`
- Update outbox types in `outbox-watcher.ts`
- Update capabilities section in persona template

**Files:** `src/channels/whatsapp.ts`, `src/outbox-watcher.ts`, `personas/assistant/CLAUDE.md`

---

### 8. Progress Streaming

**Decision:** Personality-driven via `progress.txt` in workspace.

**What:** Tool-aware progress messages during agent processing.

**Implementation:**

- New file: `~/.rclaw/agents/<user>/progress.txt`
  ```
  WebSearch: Web pe dekh rahi hoon...
  Read: File padh rahi hoon...
  Write: Likh rahi hoon...
  Edit: Changes kar rahi hoon...
  Grep: Dhoondh rahi hoon...
  Glob: Files dhoondh rahi hoon...
  ```
- Format: `ToolName: message` (multiple per tool allowed, randomized)
- Load in orchestrator alongside fillers
- In `consumeStream()`: on `tool_progress` event, look up `tool_name` in progress map
- Send via `sendFiller()` — deduplicate (don't repeat same tool within 10s)
- Falls back to generic English if file missing
- Personality designer generates this file alongside `fillers.txt`

**Files:** `src/orchestrator.ts`, `src/commands/design-personality.ts`, `personas/assistant/CLAUDE.md`

---

### 9. Session Compaction

**Decision:** Auto-only. Observe SDK events, show progress message.

**What:** Handle context window overflow gracefully.

**Implementation:**

- In `consumeStream()`: detect `{ type: "system", subtype: "status", status: "compacting" }`
- Log: `[alice] Session compacting...`
- Send progress message: "Organizing my thoughts..." (from progress.txt or default)
- No manual `/compact` command for now

**Files:** `src/orchestrator.ts`

---

### 10. Two-Tier Memory

**Decision:** MEMORY.md + HISTORY.md. Pre-seed MEMORY.md from personality designer.

**What:** Structured memory system replacing flat files.

**Implementation:**

- Add directive to persona template CLAUDE.md:
  ```
  ## Memory Structure
  - memory/MEMORY.md: Working memory. Read every session. Key facts, preferences,
    frequent contacts, decisions. Keep under 50 lines. Curate actively.
  - memory/HISTORY.md: Journal. Append-only. Notable events, decisions, corrections.
    Reference when needed, don't read every session.
  ```
- Personality designer pre-seeds `memory/MEMORY.md` with:
  ```
  # About My Owner
  - Name: [from design questions]
  - Preferences: [from design answers]
  ```
- No code change — purely directive + personality designer update

**Files:** `personas/assistant/CLAUDE.md`, `src/commands/design-personality.ts`

---

## Explicitly NOT Building

| Feature                | Reason                                                      |
| ---------------------- | ----------------------------------------------------------- |
| Shell denylist         | Already `disallowedTools: ["Bash"]` — denylist is redundant |
| Container isolation    | OS sandbox sufficient, containers add latency               |
| WhatsApp groups        | Separate product, not a feature. Park for v3.               |
| Evolution API          | Migration cost not justified while Baileys works            |
| Agent swarm            | Claude Code Agent tool already handles subagents            |
| Multi-provider routing | Contradicts constraint #1 (subscription-only)               |
| Credential proxy       | Not needed with subscription auth                           |
| Voice transcription    | High complexity, niche. Park for later.                     |
| X/Twitter automation   | Out of scope                                                |
| Manual /compact        | Auto-compact sufficient for now                             |

---

## Build Order

### Phase A: Security + Reliability (items 1, 4, 5)

1. Telegram owner ID whitelist
2. Circuit breaker
3. Telegram reliability plugins

### Phase B: Messaging Parity (items 2, 3, 6, 7)

4. WhatsApp read receipts
5. Telegram file handling
6. WhatsApp quoted replies
7. WhatsApp media sending

### Phase C: Intelligence (items 8, 9, 10)

8. Progress streaming
9. Session compaction handling
10. Two-tier memory

### Phase D: Testing

11. UAT tests for all new features (real Sonnet, LLM-judged)
12. Update behaviour tests if directives changed
13. Update persona template + personality designer

---

## Verification

After each phase:

1. `npx tsc --noEmit` — type check
2. `npm test` — unit + integration (49 tests)
3. `BEHAVIOUR=1 npm run test:behaviour` — persona directive validation (28 tests)
4. `UAT=1 npm run test:uat` — full pipeline with real Claude
5. Manual smoke test on live Telegram + WhatsApp
