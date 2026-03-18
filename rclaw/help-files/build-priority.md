# Build Priority — Agreed 2026-03-18

## Tier 1 — Quick wins (copy from existing, <1 hour each)

Ordered by user-facing impact:

1. WhatsApp read receipts — blue ticks
2. WhatsApp quoted replies — replies reference original message
3. Tool hints in chat — show what agent is doing during waits
4. WhatsApp media sending — agent sends back files/images
5. WhatsApp reactions — quick 👍 acknowledge before full reply
6. WhatsApp number validation — check before sending to contacts
7. Telegram file handling — receive and send files
8. Shell command denylist — safety net against rm -rf etc.

## Tier 2 — Medium effort (adapt patterns, 1-3 hours each)

1. Two-tier memory (MEMORY.md + HISTORY.md) — from Nanobot
2. Session compaction (/compact) — from NanoClaw
3. WhatsApp image vision (sharp + base64 multimodal) — from NanoClaw
4. Progress streaming (partial text updates) — from Nanobot
5. Token-based consolidation (auto-summarize when context fills) — from Nanobot
6. Heartbeat (periodic 30min wake-up, proactive agent) — from Nanobot

**Parked for next phase:** Voice transcription (Whisper)

## Tier 3 — Parked

All parked. Revisit subagent spawning after heartbeat works.

- Credential proxy (NanoClaw)
- Evolution API (replace Baileys)
- Agent swarm (NanoClaw)
- Subagent spawning (Nanobot) ← revisit first
- Multi-provider LLM routing (ClawRouter)
- Parallel search/tasks (NanoClaw)
- Cognee knowledge graph

## Tier 4 — Future

All parked. No timeline.

- Docker/Apple container isolation
- Message queue (RabbitMQ/Redis)
- Visual dashboard (ClawDeck)
- Browser automation
- Voice/telephony
- X/Twitter automation
- Skill marketplace
- Skills-as-branches distribution
