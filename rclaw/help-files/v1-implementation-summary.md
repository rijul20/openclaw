# v1 Implementation Summary

What was built, organized by the four pillars.

---

## Pillar 1: Core Architecture

### Built

- **V2 Session API** — replaced v0 `query()` with `unstable_v2_createSession` / `resumeSession` for persistent sessions
- **CWD Mutex** — safe concurrent `process.chdir()` during session creation
- **Session persistence** — `sessions.json` stores session IDs, survives restarts
- **OS Sandbox** — macOS `sandbox-exec`, Linux `bwrap` per session. Restricts file writes to agent workspace only.
- **Message batching** — 3.5s silence window combines rapid messages into single prompt
- **File-based outbox** — agent writes JSON to `outbox/`, orchestrator watches via `fs.watch` + polling fallback
- **Contact isolation** — separate V2 sessions per contact, restricted tools, security guardrails
- **Contact rate limiting** — 15 messages per 5-minute sliding window, owner alerted on trigger
- **Contact block detection** — `[BLOCK_CONTACT]` response triggers permanent block + owner alert
- **Contact context persistence** — task hydration from `tasks.log`, conversation history re-injection on session expiry
- **Conversation audit trail** — append-only `conversation.log` per contact
- **Error recovery** — session re-creation on failure, retry with original message
- **Idle cleanup** — 15-minute timeout closes contact sessions, resumed on next message

### Files

| File                    | What                                                      |
| ----------------------- | --------------------------------------------------------- |
| `src/orchestrator.ts`   | Core routing, sessions, batching, rate limiting, recovery |
| `src/session-store.ts`  | JSON session persistence with atomic writes               |
| `src/sandbox.ts`        | OS sandbox wrapper generation                             |
| `src/batch-timer.ts`    | Per-entity message batching                               |
| `src/outbox-watcher.ts` | File-based outbox with fs.watch + polling                 |
| `src/index.ts`          | Entry point, startup, channel wiring                      |

### Tests

- `tests/basic.test.ts` — utilities (normalizePhone, chunkText, session store, sandbox, BatchTimer)
- `tests/batching.test.ts` — batch accumulation, timer reset, flush
- `tests/isolation.test.ts` — sandbox profiles, cross-user isolation, permissions
- `tests/outbox.test.ts` — send/reply dispatch, error handling
- `tests/e2e/orchestrator.e2e.test.ts` — 20 scenarios (mock SDK): routing, batching, persistence, contact flow, blocking, rate limiting, shutdown
- `tests/uat/assistant-persona.test.ts` — 10 scenarios (real Claude): full pipeline validation

---

## Pillar 2: Agent Behaviour

### Built

- **Persona architecture** — base templates in `personas/`, personalized instances in `~/.rclaw/agents/`
- **Assistant persona** — `personas/assistant/CLAUDE.md` with 34 verified directives
- **13 behaviour directives (B1-B13):**
  - B1: Personality-driven fillers (loaded from `fillers.txt`)
  - B2: Response endings (social questions OK, work questions blocked)
  - B3: Tone adaptation (stressed→empathy, rushed→brevity, relaxed→personality)
  - B4: Learning loop (corrections saved to `memory/feedback.md`)
  - B5: Context-aware brevity (1-2 sentences default)
  - B6: Memory continuity (natural context refresh, no "nothing in memory")
  - B7: Approval gates (confirm before external actions)
  - B8: Resourcefulness (check before asking)
  - B9: Contact profile learning
  - B10: Conversational onboarding
  - B11: Priority hierarchy
  - B12: Transparent reasoning
  - B13: Specificity over generality
- **Personality designer** — `npm run design` CLI, 13 questions, generates CLAUDE.md + fillers.txt
- **Behaviour test framework** — real Sonnet for agent + judge, criteria-based evaluation

### Files

| File                                         | What                                  |
| -------------------------------------------- | ------------------------------------- |
| `personas/assistant/CLAUDE.md`               | Base assistant persona template       |
| `src/commands/design-personality.ts`         | Interactive personality designer CLI  |
| `tests/behaviour/framework.ts`               | Sonnet-based behaviour test framework |
| `tests/behaviour/b2-*.test.ts`               | Response endings tests (8 scenarios)  |
| `tests/behaviour/b3-*.test.ts`               | Tone adaptation tests (7 scenarios)   |
| `tests/behaviour/b4-*.test.ts`               | Learning loop tests (4 scenarios)     |
| `tests/behaviour/b5-*.test.ts`               | Brevity tests (5 scenarios)           |
| `tests/behaviour/b6-*.test.ts`               | Memory continuity tests (4 scenarios) |
| `help-files/architecture/agent-behaviour.md` | Directive reference + test results    |

### Test Results

- Assistant persona baseline: **23/28 (82%)** behaviour tests
- UAT baseline: **8/10** full pipeline tests

---

## Pillar 3: Channels

### Built

- **Telegram** — grammy, long polling, typing indicator, Markdown fallback, 409 retry
- **WhatsApp** — Baileys, QR pairing, LID routing fix, media download, composing presence
- **Slack** — @slack/bolt, socket mode, thread support
- **Channel adapter interface** — `ChannelAdapter` with `channelName`, `sendFiller`, `sendToContact`

### Files

| File                                  | What                            |
| ------------------------------------- | ------------------------------- |
| `src/channels/types.ts`               | ChannelAdapter interface        |
| `src/channels/telegram.ts`            | Telegram bot (grammy)           |
| `src/channels/whatsapp.ts`            | WhatsApp (Baileys) with LID fix |
| `src/channels/slack.ts`               | Slack (bolt, socket mode)       |
| `src/qr-server.ts`                    | WhatsApp QR pairing web UI      |
| `help-files/architecture/channels.md` | Channel quirks + limitations    |

### Key Fixes

- **WhatsApp LID routing** — `msg.key.senderPn` for owner detection instead of `remoteJid` (which is now a linked device ID)
- **WhatsApp E2E sync** — re-pair fresh if phone shows "Waiting for this message"

### Tests

- `tests/e2e/telegram-live.test.ts` — bot connectivity + message send (LIVE=1)
- `tests/e2e/live-roundtrip.test.ts` — 3-bot roundtrip (LIVE=1)
- Channel-specific unit tests: **not yet written**

---

## Pillar 4: Agent Capabilities

### Built

- C1: File Read/Write (Claude built-in, sandbox enforced)
- C2: Web Search (owner only)
- C3: Web Fetch (owner only)
- C4: Outbox messaging (file-based, owner only)
- C5: Memory persistence (feedback.md, owner-profile.md)
- C6: Contact profile learning (profile.md per contact)

### Planned

- C7: Document processing (smart routing of PDFs/docs)
- C8: Scheduled communications (cron briefings)
- C9: Browser control (Puppeteer/Playwright)
- C10: Phone control (telephony API)
- C11: Calendar integration (Google Calendar)
- C12: Email integration (Gmail/IMAP)

### Files

| File                                      | What                           |
| ----------------------------------------- | ------------------------------ |
| `help-files/architecture/capabilities.md` | Capability reference + roadmap |

---

## Test Architecture Summary

| Layer        | Pillar    | Command                              | Tests | Cost   |
| ------------ | --------- | ------------------------------------ | ----- | ------ |
| 1. Mock e2e  | Core      | `npm test`                           | 50    | Free   |
| 2. Behaviour | Behaviour | `BEHAVIOUR=1 npm run test:behaviour` | 28    | ~$0.50 |
| 3. UAT       | All       | `UAT=1 npm run test:uat`             | 10    | ~$1-2  |
| Live         | Channels  | `LIVE=1 npm test`                    | 8     | Free   |
