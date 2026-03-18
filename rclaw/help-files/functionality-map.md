# Functionality Map — What Exists vs What We Need

## Legend

- ✅ = We have this
- 🟡 = Partially built / broken
- ❌ = Missing, someone else built it
- 🔵 = Missing, not priority yet

---

## 1. MESSAGING CHANNELS

### WhatsApp (current: basic Baileys)

| Feature                                | rclaw | Who Built It              | Reuse From                                                    |
| -------------------------------------- | ----- | ------------------------- | ------------------------------------------------------------- |
| Text messages (send/receive)           | ✅    | —                         | —                                                             |
| Documents (receive + download)         | ✅    | —                         | —                                                             |
| Images (receive + download)            | ✅    | —                         | —                                                             |
| Video/audio (receive + download)       | ✅    | —                         | —                                                             |
| Typing indicator (composing)           | ✅    | —                         | —                                                             |
| QR code pairing                        | ✅    | —                         | —                                                             |
| Send to arbitrary contacts             | ✅    | —                         | —                                                             |
| Owner number routing                   | ✅    | —                         | —                                                             |
| Read receipts (mark as read)           | ❌    | Baileys                   | `sock.readMessages([msg.key])` — 1 line                       |
| Reactions (send/receive)               | ❌    | Baileys                   | `sock.sendMessage(jid, {react: {text: '👍', key: msg.key}})`  |
| Stickers (receive + send)              | ❌    | Baileys + bot-wa-baileys  | `sendSticker()` method                                        |
| Contacts/locations (receive)           | ❌    | Baileys                   | Extract from `msg.message.contactMessage` / `locationMessage` |
| Polls (send + receive votes)           | ❌    | Baileys                   | `getAggregateVotesInPollMessage()` for vote decryption        |
| Quoted replies (reply to specific msg) | ❌    | Baileys                   | Pass `quoted: msg` option to `sendMessage`                    |
| Message editing                        | ❌    | Baileys                   | `sock.sendMessage(jid, {edit: key, text: newText})`           |
| Message deletion                       | ❌    | Baileys                   | `sock.sendMessage(jid, {delete: key})`                        |
| Media sending (image/video/doc)        | ❌    | Baileys                   | `sock.sendMessage(jid, {image: {url: path}, caption: ''})`    |
| Link previews                          | 🔵    | Baileys + link-preview-js | Auto-generated                                                |
| Group message handling                 | 🔵    | Baileys                   | Distinguish `@g.us` vs `@s.whatsapp.net` JIDs                 |
| Number validation (onWhatsApp)         | ❌    | Baileys                   | `sock.onWhatsApp('+91...')` — check before sending            |
| Profile picture fetch                  | ❌    | Baileys                   | `sock.profilePictureUrl(jid)`                                 |
| Broadcast/status stories               | 🔵    | Baileys                   | Send to `status@broadcast`                                    |
| Multi-instance management              | 🔵    | Evolution API             | REST API, multi-session, DB-backed                            |
| Webhook event delivery                 | 🔵    | Evolution API             | RabbitMQ, Kafka, SQS, Socket.io                               |
| CRM integration (Chatwoot)             | 🔵    | Evolution API             | Out of the box                                                |

### Telegram (current: text-only grammY)

| Feature                      | rclaw | Who Built It                | Reuse From                                                |
| ---------------------------- | ----- | --------------------------- | --------------------------------------------------------- |
| Text messages (send/receive) | ✅    | —                           | —                                                         |
| Typing indicator             | ✅    | —                           | —                                                         |
| Markdown formatting          | ✅    | —                           | —                                                         |
| Delete webhook on start      | ✅    | —                           | —                                                         |
| Retry on 409 conflict        | ✅    | —                           | —                                                         |
| Photos (receive + send)      | ❌    | grammY                      | `ctx.replyWithPhoto()` / `msg:photo` filter               |
| Videos/audio/voice           | ❌    | grammY                      | `ctx.replyWithVideo()` etc.                               |
| Documents/files              | ❌    | grammY                      | `ctx.replyWithDocument()` + file download via `getFile()` |
| Stickers                     | ❌    | grammY                      | `ctx.replyWithSticker()`                                  |
| Inline keyboards/buttons     | ❌    | grammY                      | `InlineKeyboard` class                                    |
| Callback query handling      | ❌    | grammY                      | `bot.callbackQuery()`                                     |
| Reactions                    | ❌    | grammY                      | `bot.reaction('emoji', handler)`                          |
| Polls                        | ❌    | grammY                      | `ctx.replyWithPoll()`                                     |
| Conversations (multi-step)   | ❌    | grammY conversations plugin | `createConversation()`                                    |
| Interactive menus            | ❌    | grammY menu plugin          | Dynamic button menus                                      |
| Session management           | ❌    | grammY sessions plugin      | RAM, Redis, file, Supabase adapters                       |
| File upload/download         | ❌    | grammY files plugin         | `file.download()`                                         |
| Rate limiting                | ❌    | grammY rate-limiter         | Per-user spam prevention                                  |
| Auto-retry on rate limits    | ❌    | grammY auto-retry           | Automatic backoff                                         |
| Concurrent processing        | ❌    | grammY runner               | 500 concurrent updates                                    |
| Webhook mode                 | ❌    | grammY                      | Express/Hono integration                                  |
| i18n                         | 🔵    | grammY i18n/fluent          | Locale files                                              |
| Command registration         | ❌    | grammY                      | `bot.api.setMyCommands()`                                 |
| Chat action variety          | ❌    | grammY                      | `upload_photo`, `record_video`, etc.                      |
| Admin/permission checks      | ❌    | grammY                      | `ctx.getChatMember()`                                     |
| Error boundaries             | ❌    | grammY Composer             | Per-branch error isolation                                |

### Slack (current: basic bolt)

| Feature                       | rclaw | Who Built It | Reuse From         |
| ----------------------------- | ----- | ------------ | ------------------ |
| Text messages                 | ✅    | —            | —                  |
| Socket mode                   | ✅    | —            | —                  |
| Thread replies                | ✅    | —            | —                  |
| Interactive elements (blocks) | ❌    | @slack/bolt  | Block Kit          |
| File upload/download          | ❌    | @slack/bolt  | `files.upload` API |
| Reactions                     | ❌    | @slack/bolt  | `reactions.add`    |
| Slash commands                | ❌    | @slack/bolt  | `app.command()`    |

---

## 2. AGENT ORCHESTRATION

| Feature                                  | rclaw | Who Built It               | Reuse From                     |
| ---------------------------------------- | ----- | -------------------------- | ------------------------------ |
| V2 Session API (createSession)           | ✅    | —                          | NanoClaw pattern               |
| Session resume across restarts           | ✅    | —                          | NanoClaw pattern               |
| Per-user isolated workspaces             | ✅    | —                          | —                              |
| Per-contact isolated sessions            | ✅    | —                          | —                              |
| Owner vs contact routing                 | ✅    | —                          | —                              |
| Message batching (3.5s timer)            | ✅    | —                          | —                              |
| Filler/progress messages                 | ✅    | —                          | —                              |
| Contact idle timeout (15min)             | ✅    | —                          | —                              |
| Session error recovery                   | ✅    | —                          | —                              |
| Stream timeout (90s)                     | ✅    | —                          | —                              |
| Outbox-based message sending             | ✅    | —                          | —                              |
| Conversation audit log                   | ✅    | —                          | —                              |
| Multi-agent (multiple bots)              | ✅    | —                          | —                              |
| Task context flow (owner→contact)        | 🟡    | —                          | Needs V2 session.send() warmup |
| OS-level sandbox per session             | ✅    | —                          | macOS sandbox-exec             |
| Personality injection via session.send() | ✅    | —                          | —                              |
| Container isolation (Docker)             | 🔵    | NanoClaw                   | Docker per-group               |
| Message queue (RabbitMQ/Redis)           | 🔵    | Evolution API / Nanobot    | Production scaling             |
| Multi-provider LLM routing               | 🔵    | ClawRouter / ZeroClaw      | 30+ models, 78% cost savings   |
| A2A protocol (agent-to-agent)            | 🔵    | Archestra                  | Enterprise, MCP registry       |
| Visual agent management UI               | 🔵    | ClawDeck / OpenClaw Studio | Kanban, monitoring, REST API   |

---

## 3. MEMORY & PERSISTENCE

| Feature                        | rclaw       | Who Built It | Reuse From                   |
| ------------------------------ | ----------- | ------------ | ---------------------------- |
| File-based memory (memory/)    | ✅          | —            | —                            |
| CLAUDE.md identity persistence | ✅          | —            | —                            |
| Contact tasks.log              | ✅          | —            | —                            |
| Contact conversation.log       | ✅          | —            | —                            |
| Session ID storage (JSON)      | ✅          | —            | —                            |
| Engram CLI memory              | ✅ (tested) | Engram       | Go binary, ~120ms            |
| Semantic search over memory    | 🟡          | Engram       | `engram search --project`    |
| Cross-session contact memory   | 🟡          | —            | Contact profile.md pattern   |
| Knowledge graph memory         | ❌          | Cognee       | Graph-based, semantic search |
| Vector memory (embeddings)     | ❌          | memory-mem0  | Qdrant + Ollama              |
| User modeling (preferences)    | ❌          | Honcho       | Dual-peer context            |
| RAG pipeline                   | 🔵          | —            | Future: knowledge/ directory |

---

## 4. SECURITY

| Feature                             | rclaw | Who Built It | Reuse From                         |
| ----------------------------------- | ----- | ------------ | ---------------------------------- |
| Contact prompt injection detection  | ✅    | —            | —                                  |
| Auto-block + owner alert            | ✅    | —            | —                                  |
| Block persistence across restarts   | ✅    | —            | —                                  |
| OS sandbox (macOS sandbox-exec)     | ✅    | —            | claude-sandbox pattern             |
| Tool restrictions (disallowedTools) | ✅    | —            | —                                  |
| Personality/capability separation   | ✅    | —            | —                                  |
| Credential isolation proxy          | ❌    | Aquaman      | Unix domain socket, Keychain/Vault |
| Permission manifests + audit        | ❌    | ClawGuard    | Hash-chained audit logs            |
| Tool execution middleware           | ❌    | ClawBands    | Human-in-the-loop approval         |
| Pre-install skill scanner           | 🔵    | Clawhatch    | 128 automated checks               |

---

## 5. SCHEDULING & AUTOMATION

| Feature                       | rclaw | Who Built It | Reuse From               |
| ----------------------------- | ----- | ------------ | ------------------------ |
| Cron scheduler (minute tick)  | ✅    | —            | —                        |
| Task persistence (cron.json)  | ✅    | —            | —                        |
| Heartbeat (periodic check-in) | ❌    | OpenClaw     | HEARTBEAT.md pattern     |
| Webhook integration           | ❌    | Hookdeck     | Reliable webhook tunnels |

---

## 6. BROWSER / WEB

| Feature            | rclaw           | Who Built It | Reuse From                      |
| ------------------ | --------------- | ------------ | ------------------------------- |
| Web search         | ✅ (via Claude) | —            | Built-in tool                   |
| Browser automation | 🔵              | OpenClaw     | CDP, ARIA snapshots             |
| API auto-discovery | 🔵              | Unbrowse     | Learn APIs from browser traffic |

---

## 7. FEATURES FROM NANOCLAW WE DON'T HAVE

| Feature                         | What It Does                                                                              | Effort                | Reuse From                          |
| ------------------------------- | ----------------------------------------------------------------------------------------- | --------------------- | ----------------------------------- |
| Credential proxy                | HTTP proxy (port 3001) intercepts API calls; real keys never enter agent process          | Medium                | NanoClaw `credential-proxy.ts`      |
| Skills-as-branches              | Features distributed as git branches users merge; `/add-whatsapp`, `/add-telegram`, etc.  | Low (pattern)         | NanoClaw skill system               |
| Session compaction (`/compact`) | Triggers Claude SDK compaction when context gets long; archives pre-compaction transcript | Low                   | NanoClaw `/add-compact` skill       |
| WhatsApp image vision           | sharp resize + base64 for Claude multimodal                                               | Low                   | NanoClaw `/add-image-vision`        |
| Voice transcription             | Whisper API for voice notes                                                               | Low                   | NanoClaw `/add-voice-transcription` |
| PDF text extraction             | pdftotext/pdfinfo in containers                                                           | Low                   | NanoClaw `/add-pdf-reader`          |
| Agent swarm (Telegram)          | Pool of 3-5 bots with stable sender-to-bot mapping                                        | Medium                | NanoClaw `/add-telegram-swarm`      |
| X/Twitter automation            | Playwright browser on host, IPC from agent                                                | Medium                | NanoClaw `/x-integration`           |
| Container idle timeout          | Keep containers alive between messages (30min) to avoid startup cost                      | Already have (15min)  | —                                   |
| `<internal>` tag stripping      | Agent uses internal reasoning blocks stripped before user delivery                        | Low                   | NanoClaw output parser              |
| IPC system                      | File-based JSON message queues between agents/groups                                      | Already have (outbox) | —                                   |
| Parallel search/tasks           | Non-blocking deep research with scheduler polling                                         | Medium                | NanoClaw `/add-parallel`            |
| Reaction support                | WhatsApp emoji reactions with SQLite persistence + state machine                          | Low                   | NanoClaw `/add-reactions`           |

## 8. FEATURES FROM NANOBOT WE DON'T HAVE

| Feature                                  | What It Does                                                              | Effort                     | Reuse From                 |
| ---------------------------------------- | ------------------------------------------------------------------------- | -------------------------- | -------------------------- |
| Two-tier memory (MEMORY.md + HISTORY.md) | LLM curates long-term facts + grep-searchable chronological log           | Low                        | Nanobot memory system      |
| Token-based consolidation                | When prompt exceeds half context window, LLM consolidates history         | Medium                     | Nanobot consolidation loop |
| Heartbeat service                        | Periodic 30min wake-up, reads HEARTBEAT.md, decides if action needed      | Low                        | Nanobot heartbeat          |
| SSRF protection                          | Blocks requests to private IPs, validates DNS, caps redirects             | Low                        | Nanobot security module    |
| Shell command denylist                   | Blocks `rm -rf`, `format`, `dd`, fork bombs, etc.                         | Low                        | Nanobot shell security     |
| Fuzzy file edit                          | Similarity-based matching when exact match fails                          | Medium                     | Nanobot EditFile tool      |
| Subagent spawning                        | Background tasks with restricted tools, 15-iteration max, result callback | Medium                     | Nanobot SubagentManager    |
| Media group buffering                    | 0.6s buffer to group multiple photos into one message                     | Low                        | Nanobot Telegram adapter   |
| Progress streaming                       | Sends partial text updates during processing                              | Low                        | Nanobot streaming          |
| Tool hints in chat                       | Formats tool calls as concise hints (e.g. `web_search("query")`)          | Low                        | Nanobot tool hints         |
| 20+ LLM providers                        | Anthropic, OpenAI, Gemini, Groq, DeepSeek, Ollama, vLLM, etc.             | Medium                     | Nanobot provider system    |
| Skill creator                            | init/package/validate scripts for developing new skills                   | Low                        | Nanobot skill-creator      |
| Forum/topic thread support               | Telegram topic-scoped sessions in forum groups                            | Low                        | Nanobot Telegram adapter   |
| In-place restart                         | `os.execv` for zero-downtime restart                                      | Low                        | Nanobot `/restart`         |
| Markdown-to-HTML conversion              | Proper formatting with code block/table protection                        | Low                        | Nanobot Telegram formatter |
| Per-user allowlist (per channel)         | `allow_from` with `"*"` for open, specific IDs, empty for deny-all        | Already have (ownerNumber) | —                          |

---

## PRIORITY: What To Build Next (Reuse-First)

### Tier 1 — Quick wins (copy from existing, <1 hour each)

1. **WhatsApp read receipts** — 1 line from Baileys: `sock.readMessages([msg.key])`
2. **WhatsApp quoted replies** — pass `quoted: msg` to sendMessage
3. **WhatsApp number validation** — `sock.onWhatsApp()` before sending
4. **WhatsApp reactions** — `sock.sendMessage(jid, {react: ...})` (NanoClaw `/add-reactions`)
5. **WhatsApp media sending** — `sock.sendMessage(jid, {image/video/document: ...})`
6. **Telegram file handling** — grammY `getFile()` + download, `replyWithDocument()`
7. **Telegram inline keyboards** — grammY `InlineKeyboard` for confirmation prompts
8. **Telegram command registration** — `bot.api.setMyCommands()`
9. **`<internal>` tag stripping** — agent can use `<internal>` for reasoning, stripped before delivery (NanoClaw)
10. **Shell command denylist** — block `rm -rf`, `format`, `dd`, fork bombs (Nanobot)
11. **SSRF protection** — block requests to private IPs (Nanobot)
12. **Tool hints in chat** — show `web_search("query")` during processing (Nanobot)

### Tier 2 — Medium effort (adapt patterns, 1-3 hours each)

13. **Two-tier memory** — MEMORY.md (long-term facts) + HISTORY.md (chronological log) (Nanobot)
14. **Session compaction** — `/compact` command when context gets long (NanoClaw)
15. **WhatsApp image vision** — sharp resize + base64 for Claude multimodal (NanoClaw)
16. **Voice transcription** — Whisper API for voice notes (NanoClaw)
17. **PDF text extraction** — pdftotext for documents (NanoClaw)
18. **Heartbeat service** — periodic 30min wake-up, reads HEARTBEAT.md (Nanobot)
19. **Media group buffering** — 0.6s buffer to group multiple photos (Nanobot Telegram)
20. **Progress streaming** — partial text updates during long processing (Nanobot)
21. **Telegram forum/topic support** — topic-scoped sessions (Nanobot)
22. **Contact memory persistence** — profile.md per contact, agent reads on session start
23. **Token-based consolidation** — LLM consolidates history when prompt exceeds half context (Nanobot)
24. **WhatsApp contacts/locations receive** — extract from message types
25. **Markdown-to-HTML conversion** — proper Telegram formatting with code block protection (Nanobot)

### Tier 3 — Significant effort (evaluate first)

26. **Credential proxy** — HTTP proxy, real keys never enter agent process (NanoClaw)
27. **Evolution API** — replace raw Baileys with production REST API (multi-instance, monitoring)
28. **Agent swarm (Telegram)** — pool of 3-5 bots with stable sender mapping (NanoClaw)
29. **Subagent spawning** — background tasks with restricted tools, result callbacks (Nanobot)
30. **Multi-provider LLM routing** — ClawRouter / Nanobot's 20+ provider system
31. **Parallel search/tasks** — non-blocking deep research (NanoClaw)
32. **Cognee knowledge graph** — replace file-based memory with semantic graph

### Tier 4 — Future (when needed)

33. **Docker/Apple container isolation** (NanoClaw pattern)
34. **Message queue** (RabbitMQ/Redis for scaling)
35. **Visual dashboard** (ClawDeck/Mission Control)
36. **Browser automation** (NanoClaw `/agent-browser`, OpenClaw managed browser)
37. **Voice/telephony** (ClawdTalk/Telnyx)
38. **X/Twitter automation** (NanoClaw Playwright-based)
39. **Skill marketplace** (Nanobot ClawHub integration)
40. **Skills-as-branches distribution** (NanoClaw pattern)

---

## Reference Repos by Category

### Core Architecture

- **NanoClaw** — https://github.com/qwibitai/nanoclaw (V2 Session API, Docker, SQLite)
- **Nanobot** — https://github.com/HKUDS/nanobot (message bus, session-per-sender)
- **ZeroClaw** — https://github.com/theonlyhennygod/zeroclaw (Rust, hybrid SQLite, trait-based)

### WhatsApp

- **Baileys** — https://github.com/WhiskeySockets/Baileys (core library, all message types)
- **Evolution API** — https://github.com/EvolutionAPI/evolution-api (production REST API)
- **bot-wa-baileys** — https://github.com/andresayac/bot-wa-baileys (clean wrapper)

### Telegram

- **grammY** — https://github.com/grammyjs/grammY (plugins, sessions, conversations)
- **telegram-bot-template** — https://github.com/bot-base/telegram-bot-template (production patterns)

### Memory

- **Engram** — https://github.com/RyanLisse/engram (local-first, multi-agent)
- **Cognee** — https://github.com/topoteretes/cognee-integrations (knowledge graph)
- **Honcho** — https://github.com/plastic-labs/openclaw-honcho (cross-session, user modeling)
- **memory-mem0** — https://github.com/serenichron/openclaw-memory-mem0 (self-hosted vectors)

### Security

- **Aquaman** — https://github.com/tech4242/aquaman (credential proxy)
- **ClawGuard** — https://github.com/newtro/ClawGuard (permission manifests, audit)
- **ClawBands** — https://github.com/SeyZ/clawbands (tool middleware)

### Patterns

- **Agent Skills for Context Engineering** — https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering
- **Awesome OpenClaw** — https://github.com/rohitg00/awesome-openclaw
