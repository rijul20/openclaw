# Critical Analysis — Cross-Plan Review

Reviewed 2026-03-18. Covers: V1_PLAN.md, design-architecture.md, agent-archetypes.md, telegram-implementation-plan.md, and current orchestrator.ts.

## Contradictions Found & Resolutions

### 1. Bash disabled vs agent CLAUDE.md references curl

- **Issue:** Design says `disallowedTools: ["Bash"]` but old CLAUDE.md tells agent to use `curl` for sending messages
- **Resolution:** Clean up agent CLAUDE.md to remove all curl/Bash references. Agent uses outbox files only (already implemented in v1 orchestrator).

### 2. Outbox delivery has no feedback loop

- **Issue:** Agent writes outbox file → orchestrator sends → but agent says "Message sent!" before it actually goes out. No confirmation.
- **Resolution:** Orchestrator writes `<filename>.done` after successful send. Agent can optionally check. Not blocking for v1 — the latency is <1s in practice.

### 3. Contact routing is WhatsApp-only

- **Issue:** Contact isolation uses `ownerNumber` to route owner vs contact. Telegram bots are 1:1 private chats — no concept of contacts replying through the bot.
- **Resolution:** Document this explicitly. For Telegram, whitelist the owner's Telegram user ID. Strangers who message the bot are rejected (not routed to any session).
- **Decision:** Owner Telegram ID whitelisted. Strangers blocked.

### 4. Multi-agent concurrency vs subscription limits

- **Issue:** Alice (sonnet) + Veena (opus) + contact sessions all use the same Claude subscription. Unknown if Anthropic limits concurrent sessions.
- **Resolution:** Monitor for rate limit errors. Add circuit breaker (see #10). If limits exist, queue sessions instead of running concurrently. Not a problem yet at 2 agents.

## Gaps Found & Resolutions

### 5. No error handling for Telegram file downloads

- **Resolution:** Add try/catch with fallback message. Check file size before download (>20MB → tell user to use WhatsApp). Same pattern as WhatsApp.

### 6. No channel name in file notifications

- **Issue:** Agent gets `[Photo received, saved at /path...]` but doesn't know if from Telegram or WhatsApp.
- **Resolution:** Include channel name: `[Telegram photo received, saved at /path...]`

### 7. Session.send() personality not re-injected on resume

- **Issue:** After crash + restart, `resumeSession()` reuses old personality. If user updated CLAUDE.md, agent uses stale identity.
- **Resolution:** Always re-inject personality on resume, not just on first create. Read CLAUDE.md fresh each time.

### 8. Batch timer + filler race condition

- **Issue:** 3.5s batch wait + 2s filler delay = 5.5s before user sees anything.
- **Resolution:** Send filler immediately on first message (not after batch fires). If more messages come during batch window, the filler is already showing. Filler is a UX signal, not tied to processing start.

### 9. Contact idle timeout vs baileys encryption

- **Issue:** 15-min idle closes Claude session. Baileys encryption state is shared (not per-contact). Multiple concurrent operations could corrupt keys (we saw "Bad MAC" errors).
- **Resolution:** Baileys auth is process-wide, not per-session. Claude session close doesn't affect baileys. The Bad MAC errors were from re-pairing, not idle timeout. No change needed, but document that baileys auth must not be shared across multiple processes.

### 10. No circuit breaker for subscription quota

- **Issue:** If subscription hits limits, error → recovery → error → infinite loop.
- **Resolution:** After 3 consecutive session failures in 60s, stop retrying. Notify user: "I'm temporarily unavailable, please try again in a few minutes." Resume on next incoming message.

### 11. grammY conversation plugin conflicts with agent

- **Issue:** Two state machines (grammY conversations + Claude session) would fight for control of multi-step flows.
- **Resolution:** Drop conversation plugin from the plan. Agent owns all conversation state. grammY is a dumb transport pipe.

### 12. HTML parse mode breaks with AI output

- **Issue:** Switching to HTML means unescaped `<`, `>`, `&` in agent output breaks rendering.
- **Resolution:** Stay with current approach: try Markdown, fall back to plain text. Don't switch to HTML.

### 13. Files directory grows forever

- **Issue:** No cleanup policy for downloaded files.
- **Resolution:** 7-day auto-delete cron. Agent can save important files to `memory/` if it wants to keep them.
- **Decision:** 7-day retention.

### 14. No Telegram file sending

- **Issue:** Agent can receive files but can't send them back via Telegram.
- **Resolution:** Add `sendFile(filepath)` to Telegram channel adapter. Uses `bot.api.sendDocument()` or `sendPhoto()` based on extension.

## Architectural Risks & Mitigations

### 15. CWD mutex is a global bottleneck

- **Issue:** `withCwdMutex` serializes all session creation. Slow at 5+ agents.
- **Mitigation:** Acceptable for 2-5 agents (session creation is ~8s, happens once per restart). If scaling beyond 5, refactor to pass `cwd` as session option instead of `process.chdir()` (requires SDK support or wrapper script).

### 16. Single process = single point of failure

- **Issue:** Baileys crash can take down entire process.
- **Mitigation:** PM2 auto-restart (already configured). Baileys errors are caught in event handlers. True fix would be separate processes per channel, but overkill for v1.

## Decisions Log

| Decision              | Choice                            | Rationale                                                  |
| --------------------- | --------------------------------- | ---------------------------------------------------------- |
| File retention        | 7-day auto-delete                 | Prevents disk fill; agent saves important files to memory/ |
| Telegram strangers    | Whitelist owner ID                | Prevents unauthorized subscription usage                   |
| Parse mode            | Keep Markdown + fallback          | HTML too fragile with AI output                            |
| Conversation plugin   | Drop from plan                    | Agent owns conversation state, not grammY                  |
| Personality on resume | Always re-inject                  | Ensures CLAUDE.md updates take effect                      |
| Filler timing         | Send immediately on first message | 5.5s delay is too slow                                     |
| Outbox confirmation   | Write .done file (optional check) | Non-blocking, agent doesn't need to wait                   |
| Circuit breaker       | 3 failures in 60s → back off      | Prevents infinite retry loop                               |

## Items to Update

- [x] This file (critical-analysis.md)
- [ ] telegram-implementation-plan.md — remove conversation plugin, keep Markdown, add file sending, add owner ID whitelist
- [ ] design-architecture.md — add circuit breaker, add Telegram owner whitelist, add file cleanup cron, note contact routing is WhatsApp-only
- [ ] Agent CLAUDE.md — remove curl/Bash references (already done in v1 outbox pattern)
- [ ] Orchestrator — re-inject personality on resume, send filler on first message not after batch
