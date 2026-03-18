# rclaw

Multi-user AI agent orchestrator. Connects Claude Code to Telegram, WhatsApp, and Slack so your AI agent can manage conversations with you and your contacts autonomously.

## What it does

- **Owner conversations** — message your AI agent through Telegram, WhatsApp, or Slack. Persistent session with full conversation history.
- **Contact delegation** — tell your agent to message someone on your behalf. It creates an isolated session for that contact with its own task context and security guardrails.
- **Contact replies** — when a contact replies, they talk to an isolated agent that only knows the assigned task. Summaries are fed back to the owner.
- **Multi-user** — multiple users share one rclaw instance, fully isolated from each other.
- **Persona-based** — agents are built from persona templates (assistant, coach, ops) and personalized with identity (name, language, tone).

## Quick start

### Prerequisites

- **Node.js 22+**
- **Claude Code** installed and logged in (`claude` command works)
- A Telegram bot token (create one via [@BotFather](https://t.me/BotFather))

### 1. Install

```bash
git clone <repo-url>
cd rclaw
npm install
```

### 2. Configure

```bash
cp config.sample.json config.json
```

Edit `config.json`:

```json
{
  "users": {
    "alice": {
      "workspace": "./agents/alice",
      "model": "sonnet",
      "channels": {
        "telegram": {
          "botToken": "YOUR_TELEGRAM_BOT_TOKEN"
        }
      }
    }
  },
  "qrPort": 3847
}
```

**Minimal setup** — just a Telegram bot token. WhatsApp and Slack are optional.

| Field                           | Description                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `workspace`                     | Agent's working directory (created automatically)                                  |
| `model`                         | Claude model: `sonnet`, `opus`, `haiku`                                            |
| `channels.telegram.botToken`    | Telegram Bot API token                                                             |
| `channels.whatsapp.authDir`     | Path to store WhatsApp session auth                                                |
| `channels.whatsapp.ownerNumber` | Your phone number (e.g. `+919876543210`) — used to distinguish owner from contacts |
| `channels.slack.botToken`       | Slack bot token (`xoxb-...`)                                                       |
| `channels.slack.appToken`       | Slack app token (`xapp-...`) for socket mode                                       |
| `qrPort`                        | Port for WhatsApp QR pairing web UI                                                |

### 3. Design your agent's personality

The easiest way — use the interactive personality designer:

```bash
npm run design -- ./agents/alice
```

It asks 13 questions (persona, name, language, tone, humor, brevity, etc.) and generates a `CLAUDE.md` + `fillers.txt` matching your choices.

Or create manually:

```bash
mkdir -p agents/alice
cat > agents/alice/CLAUDE.md << 'EOF'
# IDENTITY.md
- **Name:** Ayesha
- **Language:** English with Hindi mixed in naturally
- **Tone:** Warm + slightly sarcastic

# Include the rest from personas/assistant/CLAUDE.md
EOF
```

### 4. Run

```bash
npm start
```

Or with auto-restart on crash:

```bash
npx pm2 start ecosystem.config.cjs
```

### 5. Message your bot

Open Telegram, find your bot, send `/start`, then say hello.

## Personas

Agents are built from **persona templates** — pre-configured behaviour patterns that you personalize with your identity.

```
Persona (template)       → Directives, values, capabilities
  + Identity (yours)     → Name, language, tone, humor, cultural context
    + Model (config)     → sonnet / opus / haiku
      = Your Agent
```

| Persona       | Description                                                        | Status                                |
| ------------- | ------------------------------------------------------------------ | ------------------------------------- |
| **assistant** | Personal AI assistant. Tasks, contacts, calendar, conversations.   | Active (82% behaviour test pass rate) |
| coach         | Reflective coach. Asks questions, nudges growth, tracks goals.     | Planned                               |
| ops           | Operations manager. Task-focused, structured, minimal personality. | Planned                               |

Base templates live in `personas/`. See `personas/README.md` for details.

## Adding WhatsApp

Add WhatsApp config to `config.json`:

```json
{
  "channels": {
    "telegram": { "botToken": "..." },
    "whatsapp": {
      "authDir": "./agents/alice/whatsapp-auth",
      "ownerNumber": "+919876543210"
    }
  }
}
```

Restart rclaw. Open `http://127.0.0.1:3847/qr/alice` in your browser and scan the QR code with WhatsApp.

**Owner vs contact routing:** Messages from your `ownerNumber` go to your main agent session. Messages from any other number create an isolated contact session.

## Contact conversations

Tell your agent to message someone:

> "Ask Priya at +919876543210 to confirm the catering order for Saturday"

The agent writes a JSON file to `outbox/`, the orchestrator picks it up, sends the WhatsApp message, and creates an isolated session for Priya. When Priya replies, she talks to a restricted agent that only knows the catering task. You get a summary of each exchange.

### How contacts work

```
You → "Ask Priya to confirm catering"
  → Agent writes to outbox/
    → Orchestrator sends WhatsApp to Priya
      → Priya replies "Confirmed for 50 people"
        → Isolated contact session responds to Priya
        → Owner gets: [Contact update from +91...]: They said "Confirmed for 50 people"
```

### Contact security

- Contacts never see your other conversations, files, or personal data
- Each contact gets an OS-level filesystem sandbox (can't read other workspaces)
- Prompt injection detection auto-blocks malicious contacts
- Blocked contacts are silently ignored forever
- Rate limiting prevents agent-to-agent conversation loops (15 messages per 5 minutes)
- Context persists across restarts — task history + conversation log re-injected on session expiry

## Architecture

```
Telegram/WhatsApp/Slack
  → Channel Adapter
    → Batch Timer (3.5s silence window)
      → Orchestrator (owner vs contact routing)
        → Owner: V2 Session (persistent, sandboxed)
        → Contact: Isolated V2 Session (restricted tools, sandboxed)
          → Response → Channel
          → Summary → Owner session
          → conversation.log (audit trail)
```

### Key design decisions

- **V2 Session API** — persistent Claude Code subprocess per entity, no cold start
- **Persona templates** — behaviour directives (B1-B13) tested and validated per persona
- **File-based outbox** — agent writes JSON to `outbox/`, no Bash needed
- **OS sandbox per session** — macOS `sandbox-exec`, Linux `bwrap`
- **Message batching** — 3.5s silence window combines rapid messages
- **Session persistence** — `sessions.json` survives restarts, `resumeSession()` restores context
- **Context persistence** — task history + conversation log re-injected on session expiry
- **Rate limiting** — 15 messages per contact per 5 minutes, owner alerted on trigger
- **Personality-driven fillers** — progress messages loaded from `fillers.txt`, matching agent language

### File layout

```
rclaw/
  personas/                    # Persona templates
    assistant/CLAUDE.md        #   Base assistant behaviour + directives
  src/                         # Source code
  tests/
    behaviour/                 #   Sonnet-based persona behaviour tests
    e2e/                       #   Integration + live Telegram tests
  help-files/
    architecture/              #   System + agent behaviour architecture docs
    historical-context/        #   Pre-implementation research & decisions

~/.rclaw/
  sessions.json                # Session IDs for resume
  sandbox/                     # Generated sandbox wrapper scripts
  agents/<user>/
    CLAUDE.md                  # Personalized agent (persona + identity)
    fillers.txt                # Personality-driven progress messages
    outbox/                    # Agent writes JSON here to send messages
    memory/                    # Agent's own notes
    files/                     # Received media
    contacts/<phone>/
      CLAUDE.md                # Security rules (orchestrator-written)
      tasks.log                # Task history with this contact
      conversation.log         # Full transcript (audit trail)
      profile.md               # Contact observations (agent-written)
      BLOCKED                  # Present if contact was blocked
```

## Testing

Three-layer test architecture:

| Layer             | Command                  | Tests | What it validates                                                                    | Cost   |
| ----------------- | ------------------------ | ----- | ------------------------------------------------------------------------------------ | ------ |
| **1. Unit + e2e** | `npm test`               | 50    | Pipeline mechanics: routing, batching, session persistence, isolation, rate limiting | Free   |
| **2. Behaviour**  | `npm run test:behaviour` | 28    | Persona directives: tone, brevity, question frequency, memory handling               | ~$0.50 |
| **3. UAT**        | `npm run test:uat`       | 10    | Full pipeline with real Claude: context leak, injection detection, audit trail       | ~$1-2  |

```bash
# Layer 1: fast, deterministic, every commit
npm test

# Layer 2: persona directives against real Sonnet
BEHAVIOUR=1 npm run test:behaviour

# Layer 3: full pipeline with real Claude — run before releases
UAT=1 npm run test:uat

# Live Telegram bot tests
LIVE=1 npm test
```

## Multi-user setup

Add more users to `config.json`:

```json
{
  "users": {
    "alice": {
      "workspace": "./agents/alice",
      "model": "sonnet",
      "channels": { "telegram": { "botToken": "ALICE_BOT_TOKEN" } }
    },
    "bob": {
      "workspace": "./agents/bob",
      "model": "opus",
      "channels": { "telegram": { "botToken": "BOB_BOT_TOKEN" } }
    }
  }
}
```

Each user gets their own bot, workspace, sessions, and sandbox. Zero shared state.

## Development

```bash
npm run dev              # Watch mode (auto-restart on changes)
npm start                # Single run
npm test                 # Unit + integration tests
npm run test:behaviour   # Persona behaviour tests (requires BEHAVIOUR=1)
npm run design           # Interactive personality designer
npx tsc --noEmit         # Type check
```
