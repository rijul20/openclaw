# Design Architecture

## Constraints (non-negotiable)

1. **Subscription-only** — no API keys, uses logged-in Claude Code subscription
2. **Cross-agent isolation** — one user's agents (owner, contacts) share zero context
3. **Cross-user isolation** — different users share zero state
4. **Latency-conscious** — minimize processing between message received and agent response

## System Layout

```
rclaw/                          # Source code (orchestrator, channels, tools)
~/.rclaw/agents/<user>/         # Runtime agent workspaces (one per user)
  CLAUDE.md                     # Personality only (identity, soul, examples, tone)
  outbox/                       # Agent writes JSON files here to send messages
  memory/                       # Agent's own notes (file-based fallback)
  files/                        # Received files (WhatsApp media, etc.)
  contacts/<identifier>/        # Per-contact isolated sessions (phone or email)
    CLAUDE.md                   # Security rules + prompt injection detection ONLY
    profile.md                  # Contact profile (agent writes/updates)
    tasks.log                   # Task history with this contact
    conversation.log            # Full transcript (orchestrator-written, audit trail)
  knowledge/                    # Future: RAG context
  projects/                     # Future: project-specific data
~/.rclaw/sessions.json          # Session ID storage for resume across restarts
~/.engram/engram.db             # Engram memory (shared DB, isolated via --project flag)
```

## Architecture: v1 — V2 Session API

```
Startup:
  → Load sessions.json
  → createSession() per user (sequential, mutex for cwd)
  → Inject personality via session.send() (from owner CLAUDE.md)
  → Inject capabilities via session.send() (outbox instructions, workspace layout)

Message in (owner):
  → Batch timer (3-4s) collects multi-message intents
  → Send instant filler ("On it 🔥")
  → session.send(batchedPrompt) → session.stream() → response
  → Watch stream for tool events → send progress signals
  → Send response back through channel

Message in (contact):
  → Route by phone number (owner vs contact)
  → If no session: resumeSession(storedId) or createSession() + inject personality + task
  → session.send(contactMessage) → response → send back to contact
  → Feed summary back to owner session

Outbox (agent → external):
  → Agent writes JSON to outbox/ via Write tool
  → Orchestrator watches (fs.watch) → sends WhatsApp → deletes file

Restart:
  → PM2 restarts orchestrator
  → resumeSession(storedId) for all active sessions from sessions.json
  → Full conversation history preserved
```

## Message Flow

```
User (Telegram/WhatsApp/Slack)
  → Channel Adapter (grammy/baileys/bolt)
    → Batch Timer (3-4s silence window)
      → Orchestrator (owner vs contact routing by phone number)
        → Owner: Persistent V2 session (sandboxed, cwd: ~/.rclaw/agents/<user>/)
        → Contact: Isolated V2 session (sandboxed, cwd: contacts/<identifier>/)
          → Response back through same channel
          → Summary fed back to owner session
          → conversation.log updated (audit trail)
```

## Security Model

### Layer 1: SDK Tool Restrictions

- **All sessions:** `disallowedTools: ["Bash"]` — no shell access
- **Contact sessions:** additionally `disallowedTools: ["WebSearch", "WebFetch"]`

### Layer 2: OS-Level Filesystem Sandbox

Each Claude Code subprocess spawned inside OS sandbox:

- **macOS:** `sandbox-exec` with per-agent profile
- **Linux/WSL:** Bubblewrap (`bwrap`) with mount namespace

Sandbox allows: agent workspace (read/write), system libs (read-only), `~/.claude` (auth), temp dirs.
Sandbox blocks: other agent workspaces, other users' dirs, `.ssh`, `.aws`, `.env`.

**Tested:** Alice's agent inside sandbox → BLOCKED reading Veena's workspace. ✅

### Layer 3: Contact Prompt Injection Detection

Contact CLAUDE.md includes detection rules. If triggered → `[BLOCK_CONTACT]` → auto-block + owner alert.

### Layer 4: Personality/Capability Separation

- Owner CLAUDE.md: personality only (safe for contacts to see via session.send injection)
- Capabilities (outbox, send API): injected only to owner session via session.send()
- Contact sessions never see capability instructions

**Note:** `canUseTool` callback does NOT work in the SDK (tested, confirmed bug). OS sandbox is the enforcement mechanism.

## Key Design Decisions

- **V2 Session API** — persistent subprocess per entity, no cold start, explicit resumeSession()
- **Workspace as knowledge base** — data flows in as files, agent reads files. RAG plugs in later without code changes.
- **File-based outbox** — agent writes JSON to outbox/, orchestrator watches and sends. No Bash needed.
- **OS sandbox per session** — hard filesystem boundary, cross-platform (macOS + Linux)
- **Message batching** — 3-4s silence timer, progress signals, bulk forward support
- **Engram for memory** — local Go binary, CLI-based (no MCP), ~120ms, project-based isolation
- **Session.send() injection** — personality and capabilities injected at session startup, not via hierarchical CLAUDE.md (tested: hierarchical loading doesn't work with V2)
- **Contact profile learning** — agent writes profile.md after conversations, adapts tone/formality per contact
- **Audit trail** — orchestrator-written conversation.log per contact, append-only, timestamped
- **15-min idle cleanup** — contact sessions closed after 15min, resumed on next message (~8s)
- **90s stream timeout** — filler message + auto-recovery on hangs
- **Contact context persistence** — on session expiry or restart, new sessions get task history + last 20 lines of conversation.log re-injected via session.send()
- **Task hydration from disk** — in-memory contactTasks map repopulated from tasks.log when contact messages after restart
- **Rate limiting (loop detection)** — 15 messages per contact per 5-minute sliding window. On trigger: polite pause to contact, [Rate limit] alert to owner with "might be automated agent" warning. Self-heals when window clears.

## Test Results (2026-03-18)

| Test                             | Result                             | Impact                       |
| -------------------------------- | ---------------------------------- | ---------------------------- |
| V2 createSession + resumeSession | ✅                                 | Core architecture confirmed  |
| canUseTool callback              | ❌ Bug in SDK                      | Use OS sandbox instead       |
| macOS sandbox-exec               | ✅ Blocks cross-user reads         | Security model confirmed     |
| Hierarchical CLAUDE.md           | ❌ Parent not loaded in V2         | Use session.send() injection |
| Engram CLI save/search           | ✅ ~120ms, project isolation works | Memory layer confirmed       |
| Contact context persistence      | ✅ Task + conversation re-injected | Survives restart + expiry    |
| Rate limiting (loop detection)   | ✅ 15/5min, pause + owner alert    | Agent-to-agent safe          |
| 3-party live e2e (Telegram bots) | ✅ Owner + contact + agent bots    | Full pipeline verified       |

## Operational Policies

### File Cleanup

- Files in `~/.rclaw/agents/<user>/files/` auto-deleted after 7 days
- Agent can save important files to `memory/` to preserve them
- Cron runs daily

### Circuit Breaker

- After 3 consecutive session failures within 60 seconds, stop retrying
- Notify user: "I'm temporarily unavailable, please try again in a few minutes"
- Resume on next incoming message after cooldown

### Telegram Access Control

- Owner Telegram user ID whitelisted in config (`ownerId` field)
- All other Telegram users silently ignored
- Contact routing is WhatsApp-only (Telegram bots are 1:1 private, no third-party contact model)

### Personality Re-injection

- On every session resume (not just first create), re-read CLAUDE.md and inject via `session.send()`
- Ensures identity updates take effect without requiring fresh session creation

### Filler Timing

- Send filler immediately on first message receipt (before batch timer fires)
- Don't wait for batch + processing to start — user needs instant acknowledgment

### Contact Rate Limiting

- 15 messages per contact per 5-minute sliding window
- On trigger: contact gets "I need a moment to catch up", owner gets `[Rate limit]` alert
- Self-heals: old timestamps prune automatically, no permanent block
- Prevents agent-to-agent infinite loops when our agent talks to another system's agent

### Contact Session Expiry Recovery

- When a contact messages after their session expired (idle timeout, restart, server-side expiry):
  1. Task hydrated from last entry in `tasks.log` on disk
  2. `resumeSession()` attempted; on failure, stale ID cleared and fresh session created
  3. New session injected with: personality + task history + last 20 lines of `conversation.log`
- No context loss across restarts or week-long gaps

## Channel-Specific Limitations

| Capability       | Telegram                                         | WhatsApp                          |
| ---------------- | ------------------------------------------------ | --------------------------------- |
| Owner routing    | By Telegram user ID                              | By phone number                   |
| Contact routing  | Not supported (1:1 bot)                          | By phone number (owner vs others) |
| File receive     | 20 MB limit (Bot API)                            | No practical limit                |
| File send        | Via sendDocument/sendPhoto                       | Via sendMessage with media        |
| Typing indicator | "typing..." action (5s TTL, we refresh every 4s) | "composing" presence              |
| Message editing  | Supported (can update filler → real response)    | Not supported                     |
| Read receipts    | Not available via Bot API                        | Available (blue ticks)            |

## Reference Implementations

- [NanoClaw](https://github.com/qwibitai/nanoclaw) — V2 Session API, Docker isolation, SQLite
- [Nanobot](https://github.com/HKUDS/nanobot) — Message bus, session-per-sender, tool registry
- [claude-sandbox](https://github.com/paulsmith/claude-sandbox) — macOS sandbox-exec for Claude Code
- [Engram](https://github.com/Gentleman-Programming/engram) — Persistent memory, CLI + MCP
