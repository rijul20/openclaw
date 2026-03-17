# rclaw

Multi-user AI agent orchestrator. Connects Claude Code to Telegram, WhatsApp, and Slack so your AI assistant can manage conversations with you and your contacts autonomously.

## What it does

- **Owner conversations** — message your AI assistant (Ayesha) through Telegram, WhatsApp, or Slack. She has a persistent session with full conversation history.
- **Contact delegation** — tell your assistant to message someone on your behalf. She creates an isolated session for that contact with its own personality, task context, and security guardrails.
- **Contact replies** — when a contact replies, they talk to an isolated agent that only knows the assigned task. Summaries are fed back to the owner.
- **Multi-user** — multiple users share one rclaw instance, fully isolated from each other.

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

### 3. Set up agent personality

Create your agent's personality file:

```bash
mkdir -p agents/alice
cat > agents/alice/CLAUDE.md << 'EOF'
You are Ayesha, a warm and professional personal AI assistant.

## Personality
- Warm, polite, and efficient
- Use natural English with light Hindi where appropriate
- Keep messages concise — this is chat, not email
- Always use "Aap" — never "Tu" or "Tum"

## About your owner
- Name: Alice
- Timezone: IST
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

Open Telegram, find your bot, send `/start`, then say hello. Ayesha should respond.

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
- **File-based outbox** — agent writes JSON to `outbox/`, no Bash needed
- **OS sandbox per session** — macOS `sandbox-exec`, Linux `bwrap`
- **Message batching** — 3.5s silence window combines rapid messages
- **Session persistence** — `sessions.json` survives restarts, `resumeSession()` restores context
- **Context persistence** — task history + conversation log re-injected on session expiry
- **Rate limiting** — 15 messages per contact per 5 minutes, owner alerted on trigger

### File layout

```
~/.rclaw/
  sessions.json              # Session IDs for resume
  sandbox/                   # Generated sandbox wrapper scripts
  agents/<user>/
    CLAUDE.md                # Agent personality
    outbox/                  # Agent writes JSON here to send messages
    memory/                  # Agent's own notes
    files/                   # Received media
    contacts/<phone>/
      CLAUDE.md              # Security rules (orchestrator-written)
      tasks.log              # Task history with this contact
      conversation.log       # Full transcript (audit trail)
      profile.md             # Contact observations (agent-written)
      BLOCKED                # Present if contact was blocked
```

## Testing

```bash
# Unit + integration tests (mock SDK)
npm test

# Include live Telegram bot tests (requires bot tokens + /start)
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
npm run dev          # Watch mode (auto-restart on changes)
npm start            # Single run
npm test             # Vitest
npx tsc --noEmit     # Type check
```
