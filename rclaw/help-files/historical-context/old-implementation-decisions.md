# Implementation Decisions

Decisions locked in. Will implement in one shot once all decisions are finalized.

## Constraints (always validate against these)

1. **Subscription-only** — no API keys, uses logged-in Claude Code subscription
2. **Cross-agent isolation** — one user's agents (owner, contacts) share zero context
3. **Cross-user isolation** — different users share zero state
4. **Latency-conscious** — every orchestrator layer adds delay before the user sees a response. Minimize processing between "message received" and "agent starts thinking." If a feature adds latency but marginal value, skip it. The user is on WhatsApp — they expect near-instant acknowledgment and fast replies.

---

## Decision 1: V2 Session API

**What:** Replace `query()` (V1) with `unstable_v2_createSession()` / `unstable_v2_resumeSession()` from `@anthropic-ai/claude-agent-sdk`.

**Why:**

- Persistent subprocess per entity — no ~12s cold start on follow-ups
- `session.send()` lets us pre-inject task context into contact sessions before they reply
- Explicit `session_id` for resume across restarts
- Multi-turn in-memory (same process)

**Tested:** Works with native binary (`/Users/rijul/.local/share/claude/versions/2.1.77`). CWD controlled via `process.chdir()` before `createSession()`.

**Constraint check:**

1. Subscription ✅ — spawns same Claude Code binary, same auth
2. Cross-agent ✅ — separate session + cwd per entity (owner, each contact)
3. Cross-user ✅ — separate session + cwd per user

**Package:** `@anthropic-ai/claude-agent-sdk` (already installed alongside `@anthropic-ai/claude-code`)

---

## Decision 2: Filesystem Sandboxing (Trust-Level Permissions)

**Problem discovered:** All agents run with `bypassPermissions` and have full Bash/Read/Write access. An agent can simply `cd ..` and read any other agent's files — CLAUDE.md, memory, contacts, everything. A contact session (untrusted external person) could be prompt-injected into running `cat /Users/rijul/.rclaw/agents/alice/memory/notes.md` and leak the owner's private data. Same applies cross-user: Veena's agent could read Alice's workspace. This violates constraints #2 and #3.

**Approach: No Bash + OS-level filesystem sandbox per session.**

### Layer 1: disallowedTools (SDK level)

**All sessions (owner + contact):**

- `disallowedTools: ["Bash"]` — removes shell escape vector. No `cd`, no `cat`, no arbitrary command execution.

**Contact sessions additionally:**

- `disallowedTools: ["Bash", "WebSearch", "WebFetch"]` — contacts don't need web access

**What owners CAN still do (that contacts can't):**

- WebSearch, WebFetch — for research tasks
- Read/Write across their own workspace (memory/, files/, contacts/)
- Agent tool for sub-agents

### Layer 2: OS-level sandbox (filesystem enforcement)

**Problem:** `canUseTool` callback does NOT fire in the SDK runtime (tested, confirmed bug). With just `disallowedTools`, the agent still has Read/Write with no path restrictions — can read any file on the system via absolute path.

**Solution:** Each Claude Code subprocess is spawned inside an OS-level sandbox that restricts filesystem access to only the agent's workspace. The orchestrator generates a wrapper script per session.

**macOS — `sandbox-exec`:**

```bash
exec sandbox-exec -f /path/to/agent-profile.sb /path/to/claude "$@"
```

Profile allows: system libs (read-only), agent workspace (read/write), `~/.claude` (auth), `/tmp` (temp). Denies: all other user paths, other agent workspaces.

**Tested:** Alice's agent inside sandbox tried to read `/Users/rijul/.rclaw/agents/veena/secret.txt` → **BLOCKED** by OS. Reading `safe.txt` inside workspace → SUCCESS.

**Linux/WSL — Bubblewrap (`bwrap`):**

```bash
exec bwrap \
  --ro-bind /usr /usr \
  --ro-bind /bin /bin \
  --ro-bind /lib /lib \
  --ro-bind /lib64 /lib64 \
  --ro-bind /etc /etc \
  --ro-bind /opt /opt \
  --bind /tmp /tmp \
  --bind /path/to/agent/workspace /path/to/agent/workspace \
  --ro-bind /home/user/.claude /home/user/.claude \
  --ro-bind /home/user/.local /home/user/.local \
  --dev /dev \
  --proc /proc \
  /path/to/claude "$@"
```

Bubblewrap uses Linux namespaces — lightweight, no Docker, single binary. Works on WSL2.

**Cross-platform orchestrator logic:**

```typescript
function createSandboxWrapper(workspace: string, claudeBinary: string): string {
  if (process.platform === "darwin") {
    // Generate sandbox-exec profile + wrapper script
    return generateMacOSSandbox(workspace, claudeBinary);
  } else {
    // Generate bwrap wrapper script
    return generateLinuxSandbox(workspace, claudeBinary);
  }
}
```

**What the sandbox allows per agent:**

- Agent's own workspace (read/write)
- System libraries, Node.js, Claude binary (read-only)
- `~/.claude` for auth (read-only, write for session persistence)
- `/tmp` or `/private/var/folders` for temp files
- Network access (needed for Claude API)

**What the sandbox blocks:**

- Other agents' workspaces
- Other users' home directories
- System config files (`.ssh`, `.aws`, `.env`)
- Any path outside the explicit allowlist

### Why no Bash for owners too

In a multi-user system (Alice + Veena), even the OS sandbox has the agent workspace as writable. If Bash were available, the agent could execute arbitrary binaries, spawn network processes, or exploit sandbox escapes. Removing Bash reduces the attack surface to just Read/Write/Glob/Grep within the sandboxed filesystem — which is exactly what we want.

### Alternatives considered

- `canUseTool` path checking — ❌ not implemented in SDK runtime (tested, zero callbacks fired)
- Docker per agent (NanoClaw) — bulletproof but heavy (~100MB per container), slower startup
- OS-level Unix users — solid but doesn't work with single Claude Code subscription login
- CLAUDE.md instructions only — soft boundary, bypassable via prompt injection

**Constraint check:**

1. Subscription ✅ — no infra change, same binary
2. Cross-agent ✅ — contacts can't Bash out; owner has soft guardrail
3. Cross-user ✅ — same approach per user; each user's contacts are sandboxed

---

## Decision 3: Session Storage — JSON File

**What:** Store session IDs in `~/.rclaw/sessions.json` as a flat key-value map.

**Format:**

```json
{
  "alice": "c7b73c35-5dbe-4805-a76c-fdbec33361dd",
  "alice:6598529894": "a1b2c3d4-...",
  "veena": "e5f6g7h8-..."
}
```

**Why JSON over SQLite:**

- We don't store message history (Claude Code sessions handle that internally)
- We don't poll — messages arrive via webhooks/websocket
- 2-5 users, not hundreds of groups — no need for indexed queries
- We just need `userId` → `sessionId` and `userId:phone` → `sessionId`
- Read on startup, write on new session creation — no concurrent write pressure

**Why NanoClaw chose SQLite (and why it doesn't apply to us):**
NanoClaw stores 7 tables: full message history, scheduled tasks, task run logs, router state. They poll every 2 seconds with timestamp-indexed queries across multiple groups, need atomic transactions for concurrent group processing, and crash recovery via cursor replay. None of this applies to our architecture — we use event-driven channels, Claude Code manages its own message history, and our scale is 2-5 users.

**Migration path:** If we later need message history queries (e.g., for RAG), we can migrate to SQLite then. JSON → SQLite is a one-time migration, same as NanoClaw did.

**Constraint check:**

1. Subscription ✅ — no infra change
2. Cross-agent ✅ — keys are namespaced (`alice` vs `alice:6598529894`)
3. Cross-user ✅ — keys are namespaced (`alice` vs `veena`)

---

## Decision 4: Contact Context Flow, Learning & Audit Trail

**What:** How task context flows from owner → contact session, how the agent learns per-contact communication style, and how the owner maintains visibility over all contact conversations.

### 4a. Context Flow (Owner → Contact → Owner)

**Outbound (owner initiates):**

1. Owner tells Ayesha "message X about Y"
2. Ayesha calls `POST /send` with `to`, `text`, and `task` description
3. Orchestrator creates contact workspace + writes CLAUDE.md (security rules, profile if exists)
4. V2 session created, task pre-injected via `session.send()` — session is warm before contact replies
5. Contact replies → routed to their isolated session

**Decision points (contact needs owner approval):** 6. If agent can't decide (e.g., price approval), summary fed back to owner session 7. Owner replies → orchestrator routes approval into contact session via `POST /reply`:

```bash
curl POST http://127.0.0.1:3848/reply \
  -d '{"userId":"alice","phone":"911234567890","text":"Owner approved. Confirm the upgrade."}'
```

8. Contact session receives the instruction and continues the conversation

**Completion:** 9. When conversation resolves, summary fed back to owner session 10. Agent updates contact profile (see 4b)

### 4b. Contact Learning (Per-Contact Profiles)

**Each contact workspace has a `profile.md` that the agent writes and updates after conversations.**

```
contacts/<identifier>/
  CLAUDE.md          # Security rules + task context (orchestrator writes)
  profile.md         # Contact profile (agent writes/updates)
  tasks.log          # Task history (orchestrator appends)
  conversation.log   # Full conversation transcript (orchestrator appends)
```

**Contact identifier:** Phone number for WhatsApp (`6598529894`), email address for email (`elina@company.com`). Not limited to phone — any contact channel.

**Profile example:**

```markdown
# Contact Profile: +911234567890

- **Name:** Ramesh
- **Role:** Concierge, Taj Palace Delhi
- **Language:** Formal English, very professional
- **Formality:** High — full sentences, polite
- **Response time:** Quick (minutes during business hours)
- **Disposition:** Friendly, helpful — a friend
- **Notes:** Knows owner is a returning guest, proactive with upgrades
- **Last interaction:** 2026-03-17 — room upgrade + dinner booking
```

**Agent instructions in CLAUDE.md:**

```
## Contact Profile
{{contents of profile.md if it exists, otherwise "New contact — no prior history"}}

## After Each Conversation
Update profile.md with observations: name, role, language preference,
formality level, disposition (friendly/neutral/difficult), response patterns,
and anything useful for future interactions.
```

**Learning loop:**

1. First contact — no profile, agent defaults to warm professional
2. After conversation — agent writes `profile.md`
3. Next interaction — CLAUDE.md includes profile, agent adapts tone/language/formality
4. Over time — agent knows to speak formal English with Taj concierge, casual Hindi with Sharma ji, and crisp corporate with a VP

**Disposition tracking:** Agent notes if contact is cooperative, difficult, unresponsive, or potentially adversarial. This feeds into how the agent approaches future conversations and what it flags to the owner.

### 4c. Audit Trail & Owner Visibility

**Problem:** Owner has no visibility into what the agent said to contacts. If something goes wrong (wrong message sent, commitment made without approval, inappropriate tone), there's no trail.

**Solution: `conversation.log` per contact — full transcript of every exchange.**

The orchestrator appends to this file on every message (both directions):

```
[2026-03-17 14:30:22] SENT: Hi Ramesh, this is Ayesha from Mr. Jain's side...
[2026-03-17 14:31:05] RECEIVED: Hello! Let me check suite availability...
[2026-03-17 14:31:45] SENT: Rooftop sounds lovely, let's go with 8pm...
[2026-03-17 14:32:10] RECEIVED: Suite is available at 8000 per night...
[2026-03-17 14:32:30] SENT: [Escalated to owner: price approval needed]
[2026-03-17 14:33:15] OWNER_INSTRUCTION: Owner approved. Confirm the upgrade.
[2026-03-17 14:33:40] SENT: Yes please, go ahead with the suite upgrade...
```

**Key properties:**

- Written by the orchestrator, not the agent — agent can't tamper with logs
- Append-only — no edits or deletions
- Includes owner instructions injected into the conversation
- Timestamped for full traceability

**Owner access:** Owner can ask Ayesha "show me the conversation with the Taj concierge" — Ayesha reads `conversation.log` from the owner session (owner session has read access to all contact dirs). Or we can expose via the API: `GET /conversations/alice/911234567890`.

**Constraint check:**

1. Subscription ✅ — no infra change, just files
2. Cross-agent ✅ — each contact has own workspace, profiles don't leak between contacts
3. Cross-user ✅ — each user's contacts under their own agent dir

---

## Decision 5: Multi-User CWD Safety

**Problem:** `process.chdir()` is global to the Node.js process. V2 `createSession()` inherits `process.cwd()` at spawn time. If Alice and Veena both trigger session creation simultaneously, one could get the other's workspace — violating constraint #3.

**Approach: Mutex + sequential startup.**

- **Startup:** Create all owner sessions sequentially (chdir → createSession → chdir → createSession). No race possible.
- **Runtime:** Contact sessions created on-demand behind an async mutex. Lock → chdir → createSession → restore cwd → unlock. One waits if two contacts message simultaneously.
- **After creation:** All subsequent `session.send()` calls don't need chdir — the subprocess already has the right cwd baked in.

**Why this is sufficient:** Sessions are created rarely (startup + first interaction with a new contact). The mutex adds negligible delay. Once a session exists, it's reused for all future messages with zero chdir calls.

**Constraint check:**

1. Subscription ✅ — no change
2. Cross-agent ✅ — mutex ensures each session gets the correct cwd
3. Cross-user ✅ — same mutex protects across users

---

## Decision 6: Message Batching, Progress Signals & Bulk Forwards

**Problem:** Humans don't write paragraphs — they send 4-5 short messages that form one intent. The agent shouldn't process "hey" as a standalone request. Also, when the agent is processing (5-30 seconds), the user has zero visibility — feels like the system is dead. And bulk forwards (20 messages/files from a group) need to be handled as one unit.

### 6a. Message Batching

**How it works:** When a message arrives, start a 3-4 second silence timer. If another message arrives, reset the timer. When the timer expires with no new messages, batch everything collected and process as one prompt.

**Example:**

```
[14:30:01] "hey"                    ← timer starts (3s)
[14:30:02] "check with taj"         ← timer resets
[14:30:03] "if pool is open tmrw"   ← timer resets
[14:30:06]                          ← 3s silence, timer fires
→ Agent receives: "hey\ncheck with taj\nif pool is open tmrw"
```

**Why 3-4 seconds:** Matches natural WhatsApp typing cadence. Most people finish their thought within 3-4 seconds between sends. Short enough to not feel laggy, long enough to catch multi-message intents.

**When idle vs busy:**

- Agent idle → batch timer (3-4s), then process
- Agent already processing → collect incoming messages, deliver as next turn when current processing completes (no separate batch timer needed, natural batching)

### 6b. Progress Signals

**Two layers:**

**1. Instant acknowledgment (orchestrator sends, not the agent):**
When batch timer fires and processing starts, immediately send a short filler through the channel. No AI needed — just a random pick from a small pool:

- "On it 🔥"
- "Hmm, let me check..."
- "One sec..."
- "Looking into it..."

This fires within milliseconds. User knows the system is alive.

**2. Tool-aware progress (from V2 stream events):**
The V2 stream emits tool use events. When we see specific tools taking time, send contextual updates:

- WebSearch detected → "Looking it up..."
- Read (large file) → "Reading through the file..."
- Bash (curl/external call) → "Sending now..."
- Long silence (>15s no stream output) → "Still working on this, almost there..."

These are sent through the channel as interim messages, not part of the agent's actual response.

### 6c. Bulk Forwards

**Scenario:** User selects 20 messages/files from another group, forwards to agent.

**Handling:**

- Batch timer collects all of them (they arrive within 1-2 seconds)
- Files downloaded sequentially (not parallel — avoids baileys rate limits)
- File size cap: skip files >25MB (videos etc.), note "Video received, too large to process"
- Message count cap: process first 25, tell user if more "Processing first 25, that's a lot"
- If many files in batch, send progress: "Got 20 files, going through them..."

**The batched prompt:**

```
[Forwarded message]: Meeting notes from Project X
[File received: document saved at /full/path/brief.pdf. Use the Read tool to open it.]
[Forwarded message]: Budget approved for Q2
[File received: image saved at /full/path/screenshot.jpg. Use the Read tool to open it.]
can you summarize what needs my attention
```

**No user instruction in the batch (just dumps files/messages):**
Trust the agent. Don't build separate code paths for "work forwards" vs "trip photos." The agent's personality and common sense handles the response:

- Work messages + docs → summarizes, highlights action items
- 30 trip photos → "Got all the photos, saved in files/. Want me to organize them?"
- Mixed → acknowledges photos, summarizes conversation parts
- Single file → "Got it, saved. Want me to take a look?"

Ayesha's CLAUDE.md already drives this behavior. The orchestrator's job is just: batch, download, present as one prompt.

### Implementation summary

```
Message arrives
  → If batch timer running: add to batch, reset timer
  → If no timer: start 3s timer, add to batch

Timer fires:
  → Download any files in batch (sequential)
  → Send instant filler ("On it 🔥")
  → Combine all messages into one prompt
  → session.send(batchedPrompt)
  → Stream response, watch for tool events → send progress signals
  → Send final response to user

While processing, new messages arrive:
  → Collect into next batch (delivered after current processing completes)
```

**Constraint check:**

1. Subscription ✅ — no change, fewer API calls actually (batching reduces turns)
2. Cross-agent ✅ — batching is per-session, no cross-contamination
3. Cross-user ✅ — each user has their own batch timer

---

## Decision 7: Message Routing — Direct (no bus)

**What:** Keep direct routing. Channels call orchestrator methods directly. No message bus abstraction.

**Why:** Bus adds complexity without solving a problem at 2-5 users with 3 channels. Batching logic lives in the orchestrator regardless. If we add 10+ channels or need middleware (rate limiting, transforms), we can refactor then.

---

## Decision 9: Error Recovery / Session Death

**Problem:** V2 sessions are live subprocesses that can die (OOM, crash, reboot). If a session dies, `session.send()` throws. The user's message is lost and they get an error.

**Approach: Try/catch + retry + recreate. No replay infrastructure.**

1. Wrap `session.send()` + `session.stream()` in try/catch
2. On failure: remove dead session from map
3. Recreate via `resumeSession(storedId)` — Claude Code's disk history provides the context
4. Retry the failed message once
5. If retry fails: notify user "Something went wrong, let me restart"
6. On orchestrator restart (PM2): recreate all sessions from `sessions.json` via `resumeSession()`

**Why no message replay:** Unlike NanoClaw (which stores messages in SQLite and rebuilds context), Claude Code sessions persist their own conversation history on disk. `resumeSession()` handles recovery internally. No extra infra needed.

**Constraint check:**

1. Subscription ✅ — no change
2. Cross-agent ✅ — each session recreated independently
3. Cross-user ✅ — separate session IDs per user
4. Latency ✅ — zero overhead on happy path (just a try/catch). Recovery adds one retry (~8s) only when a session actually dies, which is rare.

---

## Decision 11: Session Health — Stream Timeout

**Problem:** A Claude Code subprocess can hang (not dead, just stuck — no output). Messages queue up, user thinks system is frozen.

**Approach: 90-second stream timeout.**

- During `session.stream()`, if no event received for 90 seconds, treat session as stuck
- Orchestrator immediately sends a filler message to the user through the channel: pick randomly from a small pool that fits Ayesha's personality:
  - "Sorry, loo break. Give me two minutes, I'll be right back 😅"
  - "Ek second — system thoda hang ho gaya, restarting..."
  - "Oops, brain freeze. Reconnecting, one moment..."
- Kill the stuck session, recreate via `resumeSession(storedId)`, retry the message
- If retry also times out: "Okay something is genuinely off. Try again in a bit, I'm sorting it out."

**Why 90 seconds (not shorter):** Complex tasks (reading large files, web search, multi-tool chains) can legitimately take 60+ seconds. 90 seconds catches real hangs without false-triggering on heavy processing.

**Implementation:** Timer resets on every stream event. Zero overhead on normal operation — just a `setTimeout` that gets cleared on each event.

**Constraint check:**

1. Subscription ✅ — no change
2. Cross-agent ✅ — timeout per session, independent
3. Cross-user ✅ — separate timers
4. Latency ✅ — zero overhead on happy path. Recovery adds ~10s (filler + recreate + retry) only on actual hangs

---

## Decision 10: CLAUDE.md + session.send() Injection (No Hierarchical Loading)

**Original plan:** Hierarchical CLAUDE.md — parent personality auto-loaded by child sessions via Claude Code's directory tree walking.

**Test result:** ❌ Does NOT work reliably with V2 sessions. Parent CLAUDE.md was not loaded when cwd was a child directory. Tested with and without sandbox — same result. Only the CLAUDE.md in the session's own cwd was loaded.

**Revised approach: CLAUDE.md per workspace + session.send() for shared context.**

**Layout:**

```
~/.rclaw/agents/alice/
  CLAUDE.md                    ← Ayesha personality (identity, soul, examples) — source of truth
  contacts/6598529894/
    CLAUDE.md                  ← Security rules + prompt injection detection ONLY
```

**How personality reaches contact sessions:**
Orchestrator reads owner's CLAUDE.md and injects via `session.send()` at contact session startup:

```typescript
const personality = readFileSync("~/.rclaw/agents/alice/CLAUDE.md", "utf-8");
await contactSession.send(
  `[System] Your personality:\n${personality}\n\nYour task: ${taskDescription}`,
);
for await (const msg of contactSession.stream()) {
  if (msg.type === "result") break;
}
```

**How capabilities reach owner sessions:**
Same pattern — injected via `session.send()`, not in CLAUDE.md:

```typescript
await ownerSession.send(
  "[System] Your capabilities: write JSON to outbox/ to send WhatsApp messages...",
);
for await (const msg of ownerSession.stream()) {
  if (msg.type === "result") break;
}
```

**What goes where:**

- **Owner CLAUDE.md:** Personality only (identity, soul, examples, tone)
- **Contact CLAUDE.md:** Security guardrails + prompt injection rules ONLY
- **Owner session.send():** Capabilities (outbox, workspace layout, memory instructions)
- **Contact session.send():** Personality (from owner CLAUDE.md) + task + contact profile

**Benefits:**

- Personality maintained in one file (owner CLAUDE.md)
- Capabilities never leak to contacts (injected only to owner)
- No reliance on unreliable hierarchical loading
- Works reliably with V2 sessions

**Trade-off:** One extra `session.send()` at contact session startup (~2-3s). Only happens once per session creation, not per message.

**Constraint check:**

1. Subscription ✅ — no change
2. Cross-agent ✅ — capabilities only injected into owner session; contacts get personality but no tools
3. Cross-user ✅ — each user's personality file is separate
4. Latency ✅ — 2-3s one-time at session creation only

---

## Decision 12: File-Based Outbox + Contact Session Cleanup

### 12a. File-Based Outbox (Agent → External Messages)

**Problem:** Bash is disabled for all sessions (Decision 2). Agent can't `curl` the send API. Needs another way to send outbound messages to contacts.

**Approach:** Agent writes a JSON file to `outbox/` directory. Orchestrator watches with `fs.watch()`, processes, deletes.

**Flow:**

```
Agent writes → outbox/1773740000-send.json
  {"to":"+6598529894","text":"Hi Elina...","task":"Check if Shipra landed"}
Orchestrator sees file (~10-50ms) → reads → sends WhatsApp → deletes file
```

**Also used for owner replies to contact conversations:**

```
Agent writes → outbox/1773740000-reply.json
  {"phone":"6598529894","text":"Owner approved the upgrade. Confirm it."}
Orchestrator routes into the contact session
```

**What does NOT use the outbox:**

- You → Ayesha (direct: WhatsApp → Baileys → session)
- Ayesha → You (direct: session response → Baileys → WhatsApp)
- Contact → Ayesha (direct: Baileys → contact session)

Outbox is only for agent-initiated outbound to third parties.

**Latency:** Under 100ms (`fs.watch` trigger + file read + delete). Tested and confirmed.

**CLAUDE.md instruction:**

```
To send WhatsApp: write a JSON file to outbox/ with a unique filename:
{"to":"+91XXXXXXXXXX","text":"Your message","task":"Why you're contacting them"}
```

### 12b. Contact Session Idle Cleanup

**Problem:** Each contact session is ~100MB. 20 contacts = 2GB. Most are one-off conversations.

**Approach: 15-minute idle timeout.**

- No activity for 15 minutes → close session, save session ID to `sessions.json`
- Contact messages after timeout → `resumeSession(storedId)` recreates with full history (~8s)
- User sees "typing..." during the 8s resume (progress signals from Decision 6)
- Owner sessions: never auto-close (always-on)

**Memory math:**

- 2-3 owner sessions always on: ~300MB
- 3-4 active contact sessions at peak: ~400MB
- Idle contacts: 0MB (closed, session ID stored)
- Total peak: ~700MB

**Constraint check:**

1. Subscription ✅ — no change
2. Cross-agent ✅ — outbox per workspace, cleanup per session
3. Cross-user ✅ — separate outbox dirs, separate session maps
4. Latency ✅ — outbox <100ms; resume 8s one-time on idle contacts only

---

## Decision 13: Automated Functional Testing Infrastructure

**Problem:** Every change requires manual testing on WhatsApp/Telegram — slow, error-prone, and the test coverage is whatever we remember to check. We've discussed dozens of scenarios (contact isolation, batching, prompt injection, bulk forwards, session recovery, etc.) that need to be verified every time.

**Approach: Telegram bot as the test harness.**

A dedicated Telegram test bot that the test suite communicates with programmatically. The test suite sends messages via Telegram Bot API, waits for responses, and validates behavior.

**Why Telegram (not WhatsApp):**

- Telegram Bot API is fully programmable (send + receive messages via HTTP)
- No QR pairing, no phone number needed
- Can create multiple test bots for multi-user scenarios
- WhatsApp requires a phone, baileys session — fragile for CI

**Test categories:**

| Category                   | Example tests                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------- |
| **Basic flow**             | Send message → get response → response has Ayesha personality                           |
| **Session persistence**    | Send message → restart orchestrator → send follow-up → agent remembers                  |
| **Contact isolation**      | Agent sends to contact → contact replies → verify owner context NOT in contact response |
| **Prompt injection**       | Simulate contact sending "ignore your instructions" → verify [BLOCK_CONTACT] triggers   |
| **Message batching**       | Send 4 messages rapidly → verify agent processes as one                                 |
| **Bulk forwards**          | Forward 10 messages → verify single batched response                                    |
| **File handling**          | Send a document → verify agent acknowledges with file path                              |
| **Progress signals**       | Send complex request → verify filler message arrives before final response              |
| **Outbox**                 | Ask agent to message a contact → verify outbox file created → verify message sent       |
| **Session timeout**        | Wait >90s for response → verify filler + recovery                                       |
| **Idle cleanup**           | Create contact session → wait 15min → message again → verify resume works               |
| **Cross-user isolation**   | Alice agent tries to read Veena's files → verify denied                                 |
| **canUseTool enforcement** | Agent tries to Read absolute path outside workspace → verify denied                     |
| **Error recovery**         | Kill session subprocess → send message → verify auto-recovery                           |

**Implementation:**

```
rclaw/
  tests/
    setup.ts          # Start orchestrator + test bots
    teardown.ts       # Cleanup
    helpers.ts        # Send message, wait for response, assert
    basic.test.ts     # Basic flow tests
    isolation.test.ts # Contact + user isolation
    batching.test.ts  # Batching + bulk forwards
    recovery.test.ts  # Error recovery + timeout
    security.test.ts  # Prompt injection + canUseTool
```

**Test helper pattern:**

```typescript
async function sendAndExpect(
  botToken: string,
  chatId: string,
  message: string,
  timeout: number,
): Promise<string> {
  // Send message via Bot API
  // Poll getUpdates for response
  // Return response text
  // Throw if timeout
}
```

**Run:** `pnpm test` or `npx vitest` — same as the parent repo.

**Constraint check:**

1. Subscription ✅ — tests use the same Claude Code subscription (real agent, not mocked)
2. Cross-agent ✅ — tests explicitly verify isolation
3. Cross-user ✅ — tests explicitly verify isolation
4. Latency ✅ — tests measure response times, flag regressions

---

## Decision 8: Memory Persistence — Engram with File-Based Fallback

**What:** Use Engram (local Go binary + SQLite + FTS5) as the persistent memory layer, registered as an MCP server per V2 session. Fall back to simple files (`memory/`, `profile.md`) if MCP doesn't work with the native binary.

**Why Engram:**

- No API key — single Go binary, fully local ✅ (constraint #1)
- MCP-native — agent gets `mem_save`, `mem_search`, `mem_session_summary` as tools
- SQLite + full-text search — fast retrieval without vector DB infra
- Per-agent database — each agent/contact gets own `engram.db` in their workspace ✅ (constraints #2, #3)
- Designed for Claude Code — works out of the box

**Why not Mem0:**

- Requires an LLM API key for memory extraction (OpenAI etc.) — violates constraint #1
- Heavier infra (Docker + Qdrant + Postgres for self-host)
- Smarter (automatic extraction, semantic search), but the API key dependency is a dealbreaker
- Future upgrade path: if we ever add API keys, Mem0 replaces Engram as the memory layer

**Why not Honcho:**

- Cloud service with API key, or self-host with significant setup
- Violates constraint #1

**Per-agent layout:**

```
~/.rclaw/agents/alice/
  engram.db                    ← owner memory
  contacts/6598529894/
    engram.db                  ← contact-specific memory
```

**Integration — orchestrator-managed, no MCP:**

Engram exposes CLI, HTTP API, and MCP. We skip MCP (unreliable, adds latency) and use the orchestrator as the Engram interface:

1. **Owner sessions:** Agent writes to `memory/` folder via Read/Write tools (has file access within workspace). Orchestrator periodically indexes `memory/` files into Engram via `engram save` (child_process).
2. **Contact sessions:** After each conversation, orchestrator calls `engram save` to store contact profile updates and conversation summaries.
3. **Retrieval:** Before creating/warming a session, orchestrator calls `engram search` to pull relevant memories and injects them into the session context via `session.send()`.

No agent calls Engram directly — all goes through the orchestrator. This works because Bash is disabled for all sessions (Decision 2).

```typescript
// Orchestrator calls (not the agent)
import { execSync } from "child_process";
execSync(`engram save "Contact profile" "${summary}" --project ${userId}`);
const results = execSync(`engram search "food preferences" --project ${userId}`);
```

**File-based fallback:** If Engram binary is not installed or fails:

- `memory/` folder — agent writes notes via Read/Write tools
- `profile.md` per contact — agent updates after conversations
- `conversation.log` — orchestrator appends full transcript
- Graceful degradation — everything still works, just no semantic search across memories

**Constraint check:**

1. Subscription ✅ — Engram is local, no API key, no external LLM
2. Cross-agent ✅ — separate `engram.db` per agent/contact workspace
3. Cross-user ✅ — separate databases under each user's agent dir
