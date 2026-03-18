# Agent Capabilities Architecture

What agents can DO — current capabilities, planned additions, and how to extend.

---

## Current Capabilities (v1)

### C1: File Read/Write

- **How:** Claude Code built-in tools (Read, Write, Edit, Glob, Grep)
- **Scope:** Agent's own workspace only (sandbox enforced)
- **Used for:** Memory notes, feedback, contact profiles, task logs

### C2: Web Search

- **How:** Claude Code built-in WebSearch tool
- **Scope:** Owner sessions only (contacts have it disabled via `disallowedTools`)
- **Used for:** Research, lookups, information gathering

### C3: Web Fetch

- **How:** Claude Code built-in WebFetch tool
- **Scope:** Owner sessions only
- **Used for:** Reading specific URLs, pulling data

### C4: Outbox Messaging

- **How:** Agent writes JSON to `outbox/` directory → orchestrator watches → sends via channel
- **Scope:** Owner sessions only (contacts don't have outbox instructions)
- **Format:** `{"type":"send","to":"+91...","text":"...","task":"...","channel":"whatsapp"}`
- **Tests:** Outbox unit tests + UAT UC5

### C5: Memory Persistence

- **How:** Agent reads/writes files in `memory/` directory
- **Scope:** All sessions (owner + contacts for profile.md)
- **Files:** `feedback.md` (corrections), `owner-profile.md` (preferences), ad-hoc notes
- **Directive:** B4 (Learning Loop), B6 (Memory Continuity)

### C6: Contact Profile Learning

- **How:** Agent writes `contacts/<phone>/profile.md` after conversations
- **Scope:** Contact sessions
- **Directive:** B9

---

## Disabled Capabilities

| Capability                  | Why disabled                                    | Enforced by                     |
| --------------------------- | ----------------------------------------------- | ------------------------------- |
| Bash/shell                  | Security — prevents `cd ..` escape from sandbox | `disallowedTools: ["Bash"]`     |
| WebSearch (contacts)        | Contacts don't need web access                  | `disallowedTools`               |
| WebFetch (contacts)         | Contacts don't need web access                  | `disallowedTools`               |
| Cross-workspace file access | Isolation                                       | OS sandbox (sandbox-exec/bwrap) |

---

## Planned Capabilities

### C7: Document Processing (planned)

- **What:** Agent receives PDF/DOC via WhatsApp, reads and summarizes/acts on it
- **Current state:** Files downloaded and saved to `files/`. Agent told the path. Can Read images/PDFs if Claude Code supports the format.
- **Gap:** No smart routing (e.g., "this is an invoice" → auto-extract data)
- **Pillar:** Capabilities

### C8: Scheduled Communications (planned)

- **What:** Cron-triggered briefings — morning summary, evening reflection, weekly review
- **Current state:** Scheduler infrastructure exists (`src/tools/scheduler.ts`) but not wired to personas
- **Gap:** Need CLAUDE.md directives for briefing format + cron config per user
- **Pillar:** Capabilities + Behaviour

### C9: Browser Control (planned)

- **What:** Agent can browse websites, fill forms, extract data
- **How:** Would need a browser tool (Puppeteer/Playwright) exposed via MCP or custom tool
- **Gap:** Not started. Need MCP server or tool wrapper.
- **Pillar:** Capabilities

### C10: Phone Control (planned)

- **What:** Agent can make calls, send SMS, interact with phone functions
- **Current state:** Placeholder in old MCP tools (removed in v1)
- **Gap:** Not started. Need telephony API integration.
- **Pillar:** Capabilities

### C11: Calendar Integration (planned)

- **What:** Agent reads/writes calendar events
- **How:** Google Calendar API or CalDAV
- **Gap:** Not started. Agent currently can't check "what meetings do I have"
- **Pillar:** Capabilities

### C12: Email Integration (planned)

- **What:** Agent reads/drafts/sends emails
- **How:** Gmail API or IMAP
- **Gap:** Not started.
- **Pillar:** Capabilities

---

## Adding a New Capability

1. **Decide the access method:**
   - Built-in Claude Code tool? (easiest — just don't disable it)
   - File-based? (like outbox — agent writes file, orchestrator processes)
   - MCP tool? (custom server exposing the capability)
   - External API? (agent calls via WebFetch or custom tool)

2. **Decide the scope:**
   - Owner only? Contact only? Both?
   - Add to `disallowedTools` if restricting

3. **Add to CLAUDE.md:**
   - Capabilities section in persona template
   - Instructions for how to use it

4. **Add tests:**
   - Unit test for the mechanism
   - UAT scenario for the full pipeline
   - Document in this file

5. **Security review:**
   - Can contacts abuse this?
   - Does it leak information across sessions?
   - Does the sandbox need updating?

---

## Testing

| Capability           | Tested by                                |
| -------------------- | ---------------------------------------- |
| C1: File Read/Write  | Mock e2e (sandbox isolation tests)       |
| C2: Web Search       | Not directly tested (Claude built-in)    |
| C3: Web Fetch        | Not directly tested (Claude built-in)    |
| C4: Outbox           | Outbox unit tests + UAT UC5              |
| C5: Memory           | Behaviour B4, B6 tests (directive level) |
| C6: Contact Profiles | Not directly tested                      |
