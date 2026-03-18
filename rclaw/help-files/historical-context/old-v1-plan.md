# rclaw v1 — Research & Plan

## Reference Repos

### NanoClaw (Most Directly Relevant)

**https://github.com/qwibitai/nanoclaw**

Solves our exact SDK problem. Key patterns:

- **V2 `createSession()` API** with `send()/stream()` for persistent multi-turn conversations
- **Session resumption** via `resume: sessionId` stored in SQLite per group
- **Hierarchical CLAUDE.md** loading with `settingSources: ['project']` — auto-discovers parent + group-specific identity files
- **Container isolation** per group (Docker) — overkill for us but pattern is sound
- **Baileys WhatsApp** with channel factory pattern
- **MCP tools** registered dynamically per invocation
- **SQLite** for message history + session state
- Uses `@anthropic-sdk/sdk` v0.2.29 (not `@anthropic-ai/claude-code`)

**SDK pattern they use:**

```typescript
const session = await unstable_v2_createSession({ model: "claude-3-5-sonnet-20241022" });
await session.send("first message");
for await (const msg of session.stream()) {
  /* process */
}
await session.send("follow-up"); // same subprocess, no cold start
```

**Session continuity:**

```typescript
// First invocation
const result = await agent.invoke({ resume: null });
setSession(groupFolder, result.session_id);

// Subsequent invocations
const priorSessionId = getSession(groupFolder);
await agent.invoke({ resume: priorSessionId });
```

**Hierarchical memory:**

```
groups/CLAUDE.md            → global context (loaded first)
groups/{name}/CLAUDE.md     → group-specific (overrides global)
settingSources: ['project'] → SDK auto-discovers both
```

### Nanobot (Architecture Ideas)

**https://github.com/HKUDS/nanobot**

Ultra-lightweight, good architecture patterns:

- **Two-queue message bus**: `Channel → Inbound Queue → Agent Loop → Outbound Queue → Channel` (cleaner than direct routing)
- **Session keyed by `channel:chat_id`** — exactly the per-contact isolation we need
- **JSONL session files** per conversation — lightweight, no DB needed
- **Tool registry** with execute/validate pattern
- **`allowFrom` whitelists** per channel — similar to our ownerNumber
- **15 channel adapters** (Telegram, Discord, WhatsApp, Slack, Matrix, etc.)
- Python-based (LiteLLM) — can't reuse code directly but architecture is portable
- WhatsApp via Node.js bridge using Baileys v7, same approach as ours

### Awesome-OpenClaw (Reusable Plugins)

**https://github.com/rohitg00/awesome-openclaw**

Most relevant tools for our use case:

**Memory & Context (solves contact history problem):**

- **Engram** — https://github.com/RyanLisse/engram — multi-agent unified memory, Convex sync
- **Honcho** — https://github.com/plastic-labs/openclaw-honcho — persistent memory with dual-peer context, cross-session
- **Supermemory** — https://github.com/supermemoryai/openclaw-supermemory — unlimited memory, auto-stores conversations
- **Cognee** — https://github.com/topoteretes/cognee-integrations — knowledge graphs, relationship mapping

**Agent Orchestration:**

- **Archestra** — https://github.com/archestra-ai/archestra — MCP registry + A2A protocol (agent-to-agent messaging), agentic security
- **Clawdeck** — https://github.com/clawdeckio/clawdeck — Kanban, agent monitoring, REST API
- **Mission Control** — https://github.com/abhi1693/openclaw-mission-control — RBAC, war room, transcript management

**Messaging:**

- **LangBot** — https://github.com/langbot-app/LangBot — unified bot framework for Telegram, WhatsApp, Discord

**Cost Optimization:**

- **ClawRouter** — https://github.com/BlockRunAI/ClawRouter — smart routing, 78% cost savings

### Agent Skills for Context Engineering (Patterns Library)

**https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering**

Pattern library (not a framework) with multi-agent system designs. Key patterns:

- **Three architectures**: Orchestrator (central coordinator), Peer-to-peer (lateral), Hierarchical (task decomposition) — we use Orchestrator
- **Progressive disclosure**: Skills load metadata first, full content only when activated. Apply to contact sessions: minimal task context, expand if conversation deepens
- **Context packaging**: Each agent receives only necessary info for its role. Validates our owner↔contact isolation
- **Filesystem-based context**: Agents reference external files, not embedded state. Validates our "workspace as knowledge base" principle
- **Three-tier memory**: Short-term (current conversation) / Long-term (persistent files) / Graph-based (relationships). Maps to our `memory/` + future `knowledge/`
- **Tool output offloading**: Store results in files, not conversation history. Prevents context window bloat
- **Task handoff**: Compress context for transfer between agents — relevant for owner→contact summaries
- **Digital brain skill example**: Multi-agent system monitoring external accounts with isolated contexts — closest analog to our contact delegation model

**Key directories to study:**

- `/skills/multi-agent-patterns/` — orchestrator/delegation patterns
- `/examples/digital-brain-skill/` — external communication reference
- `/skills/memory-systems/` — three-tier memory architecture

## Other Research (Web Search)

- **V2 Session API demos**: https://github.com/anthropics/claude-agent-sdk-demos/tree/main/hello-world-v2
- **SDK overhead issue** (~12s per query() call): https://github.com/anthropics/claude-agent-sdk-typescript/issues/34
- **Context Gateway** (history compaction): https://github.com/Compresr-ai/Context-Gateway
- **OctoArch** (RBAC + WhatsApp): https://github.com/danieldavidkaka-dot/octoarch

---

## Current State (v0)

### Working

- Telegram + WhatsApp channels with Ayesha persona
- Typing indicators (Telegram + WhatsApp composing)
- WhatsApp file downloads (images, docs, PDFs) to workspace
- Session persistence across restarts (`--continue`)
- Owner message routing (ownerNumber → main session)
- Localhost HTTP API (port 3848) for outbound WhatsApp
- Contact isolation architecture (separate per-phone session dirs)
- Prompt injection guardrails + auto-block for contact sessions
- PM2 ecosystem config

### Broken / Incomplete

- Contact session bridging — task context doesn't reliably flow from owner → contact session
- Contact sessions start cold (no task context on first reply)
- MCP tools disabled (crashed with native binary)
- ~12s cold start per query() call (no hot process reuse)
- Claude binary path hardcoded

---

## v1 Plan

### 1. Adopt V2 Session API (from NanoClaw)

**Priority: Critical — fixes cold start + contact bridging**

- Switch from `query()` to `unstable_v2_createSession()` + `send()/stream()`
- One persistent subprocess per user AND per contact
- Pre-inject task context into contact session before they reply
- Store session IDs in SQLite or JSON file
- Use `resume: sessionId` for cross-restart persistence
- Use `settingSources: ['project']` for hierarchical CLAUDE.md loading

### 2. Message Bus Architecture (from Nanobot)

**Priority: High — cleaner routing**

- Decouple: Channel → Inbound Queue → Agent Loop → Outbound Queue → Channel
- Session keyed by `channel:chat_id` for per-contact isolation
- JSONL session files per conversation

### 3. Contact Context Flow

**Priority: High — core feature**

When owner says "message Elina to check if Shipra landed":

1. Owner session processes request, calls `/send` API with `task` field
2. Orchestrator creates contact workspace + CLAUDE.md with task context
3. V2 session created for contact, task context pre-injected via `send()`
4. Contact replies → routed to their session (already warm with context)
5. When conversation resolves → summary fed back to owner session
6. Contact session persisted for future conversations

### 4. Persistent Contact Memory

**Priority: Medium — nice to have for v1**

- Evaluate Engram or Honcho for cross-session contact memory
- Or simple: append conversation summaries to `contacts/<phone>/history.md`
- Agent reads history on session startup

### 5. Security Hardening

**Priority: High**

- Prompt injection detection in contact sessions (already built)
- Auto-block + owner alert (already built)
- RBAC per contact (what they can ask about)
- Rate limiting per contact

### 6. Consider LangBot for Channel Layer

**Priority: Low — evaluate only**

- Could replace hand-rolled grammy/baileys/bolt adapters
- Unified interface, maintained by community
- Trade-off: less control, another dependency

---

## Design Principle: Workspace as Knowledge Base

**Key insight: data flows into the workspace as files, the agent reads files.** Claude Code already reads everything in its cwd. When RAG, data pipelines, or external sources come later, they just write files into the workspace. No architecture change needed — the agent doesn't care who wrote a file.

This means the workspace directory structure matters. Proposed layout:

```
~/.rclaw/agents/alice/
  CLAUDE.md              # identity + soul + examples
  memory/                # agent's own notes and observations
  files/                 # received files (WhatsApp media, etc.)
  contacts/              # per-contact sessions + history
  knowledge/             # future: RAG drops retrieved context here
  projects/              # future: project-specific data, briefs, docs
```

**Decision needed:** Confirm this layout before v1 work begins. The `knowledge/` and `projects/` dirs are cheap to create now but establishing the convention early prevents a migration later.

**What this enables long-term:**

- RAG pipeline writes to `knowledge/` → agent reads it naturally
- Project briefs in `projects/` → agent has context without prompt stuffing
- Contact history in `contacts/<phone>/history.md` → agent knows who they've talked to
- All of this works without any code changes to the orchestrator — just more files in the workspace

---

## Config (current)

- Telegram bot token: in `rclaw/config.json` (gitignored)
- Owner WhatsApp: +919916978177
- Agent workspace: `~/.rclaw/agents/alice/`
- WhatsApp auth: `~/.rclaw/agents/alice/whatsapp-auth/`
- Claude binary: `/Users/rijul/.local/share/claude/versions/2.1.77`
