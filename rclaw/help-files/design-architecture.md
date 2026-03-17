# Design Architecture

## Constraints (non-negotiable)

1. **Subscription-only** — no API keys, uses logged-in Claude Code subscription
2. **Cross-agent isolation** — one user's agents (owner, contacts) share zero context
3. **Cross-user isolation** — different users share zero state

## System Layout

```
rclaw/                          # Source code (orchestrator, channels, tools)
~/.rclaw/agents/<user>/         # Runtime agent workspaces (one per user)
  CLAUDE.md                     # Identity (loaded by Claude Code on each session)
  memory/                       # Agent's own notes
  files/                        # Received files (WhatsApp media, etc.)
  contacts/<phone>/             # Per-contact isolated sessions
    CLAUDE.md                   # Task-only context + security guardrails
    tasks.log                   # Task history with this contact
  knowledge/                    # Future: RAG context
  projects/                     # Future: project-specific data
```

## Architecture: v0 (current) vs v1 (next)

### v0 — `query()` per message

```
Message in → spawn new Claude Code subprocess → wait ~12s → response → process dies
Next message → spawn again → --continue resumes from disk → ~12s again
```

- Every message = new process, cold start
- Contact sessions start completely cold (no task context)
- `--continue` resumes from disk but still re-spawns

### v1 — V2 Session API (persistent subprocess)

```
Startup → createSession() per user → subprocess stays alive
Message in → session.send() → instant response via session.stream()
Contact task → createSession() for contact → pre-inject task context → ready for reply
Restart → resumeSession(storedId) → picks up where it left off
```

- One hot subprocess per user + per active contact
- Multi-turn in-memory (no cold start after first message)
- Pre-inject task context before contact replies
- Explicit session IDs stored for resume across restarts
- Same subscription, same binary, no API keys

### What changes

|                   | v0 (`query()`)           | v1 (`createSession()`)         |
| ----------------- | ------------------------ | ------------------------------ |
| Process lifetime  | Per-message (dies after) | Persistent (stays alive)       |
| Follow-up latency | ~12s (re-spawn)          | Instant (same process)         |
| Contact warmup    | Cold (no context)        | Pre-injected via `send()`      |
| Session resume    | Implicit (`--continue`)  | Explicit (`resumeSession(id)`) |
| Auth              | Subscription ✅          | Subscription ✅                |

## Message Flow

```
User (Telegram/WhatsApp/Slack)
  → Channel Adapter (grammy/baileys/bolt)
    → Orchestrator (owner vs contact routing by phone number)
      → Owner: Persistent V2 session (cwd: ~/.rclaw/agents/<user>/)
      → Contact: Isolated V2 session (cwd: contacts/<phone>/)
        → Response back through same channel
        → Summary fed back to owner session
```

## Key Design Decisions

- **One Node.js process** — orchestrator routes everything, manages V2 sessions
- **Workspace as knowledge base** — data flows in as files, agent reads files. RAG plugs in later without code changes.
- **Session per entity** — owner gets one, each contact gets one, all persistent
- **Contact isolation** — separate cwd + CLAUDE.md + session ID per contact. Owner context never visible.
- **Security** — contact CLAUDE.md includes prompt injection detection. Auto-blocks and alerts owner.
- **Channel-agnostic** — same agent reachable from multiple channels, same session
