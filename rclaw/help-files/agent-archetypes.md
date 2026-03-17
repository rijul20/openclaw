# Agent Archetypes

We design two base archetypes. Users pick one and customize the CLAUDE.md identity.

## Sonnet Agent (default)

- **Model:** `sonnet`
- **Best for:** Day-to-day EA tasks, messaging, scheduling, quick research, file management
- **Character:** Fast, responsive, conversational
- **Cost:** ~5x cheaper than Opus
- **Latency:** ~5-10s per response
- **Use when:** Most interactions — chat, reminders, WhatsApp delegation, quick lookups

## Opus Agent

- **Model:** `opus`
- **Best for:** Deep research, complex analysis, long document processing, strategy, coding
- **Character:** Thorough, nuanced, better at ambiguity
- **Cost:** Higher
- **Latency:** ~15-30s per response
- **Use when:** Tasks requiring deep reasoning, multi-step planning, working with large documents

## Parameters That Affect Agent Behavior

### 1. Model (`model`)

The biggest lever. Sonnet vs Opus vs Haiku. Affects reasoning depth, cost, and speed.

### 2. Identity (CLAUDE.md)

The personality, rules, tone, and capabilities the agent follows. This is the main customization surface. Same model + different CLAUDE.md = completely different agent.

### 3. Permission Mode (`permissionMode`)

Currently `bypassPermissions` (full tool access). Options:

- `bypassPermissions` — agent can do anything (read/write/bash/web)
- `default` — asks for permission on risky actions
- `plan` — read-only, can only suggest actions
- `acceptEdits` — can read + edit files, but asks before bash/web

This is a major behavior lever — a `plan` mode agent is a pure advisor, `bypassPermissions` is a full autonomous agent.

### 4. Workspace (`cwd`)

What the agent can see and access. Defines the agent's "world." An agent with access to `~/Documents` has very different capabilities than one limited to a small workspace.

### 5. Tools (when MCP is enabled)

Custom tools change what the agent can do — send WhatsApp, schedule tasks, query databases, etc. Two agents with the same model but different tools behave very differently.

### 6. Max Turns (future: `maxTurns`)

Limits how many tool-use rounds the agent can take per message. Low = quick responses, high = deep multi-step work. Not yet exposed in our config but supported by the SDK.

### 7. System Prompt / Append Prompt (future)

The SDK supports `customSystemPrompt` and `appendSystemPrompt` for injecting context beyond CLAUDE.md. Useful for runtime context injection (e.g., RAG results, calendar data).

## Recommended Archetypes

### "EA" (Executive Assistant)

```json
{
  "model": "sonnet",
  "permissionMode": "bypassPermissions"
}
```

CLAUDE.md: Conversational, proactive, warm personality. Full tool access for messaging, file management, scheduling.

### "Analyst"

```json
{
  "model": "opus",
  "permissionMode": "bypassPermissions"
}
```

CLAUDE.md: Thorough, methodical, detail-oriented. Used for research tasks, document analysis, strategy work.

### "Advisor" (read-only)

```json
{
  "model": "opus",
  "permissionMode": "plan"
}
```

CLAUDE.md: Gives recommendations but never takes action. Safe for sensitive contexts where you want analysis without execution.

## What Stays The Same Across Archetypes

- Channel adapters (Telegram, WhatsApp, Slack)
- Contact isolation model
- Security guardrails for third-party contacts
- Workspace structure (memory/, files/, contacts/, etc.)
- Session persistence
