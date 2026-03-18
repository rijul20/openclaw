# Communication Patterns Analysis

Research across OpenClaw SOUL.md, PAI, aaronjmars/soul.md, mberman84's prompts, Dopamine Digital SOP, and system prompt libraries. Compared against our current Ayesha implementation.

## What We Already Do Well

| Pattern                    | Industry Best Practice          | Our Implementation                              | Status          |
| -------------------------- | ------------------------------- | ----------------------------------------------- | --------------- |
| Personality-first          | SOUL.md defines who before what | IDENTITY.md + SOUL.md + EXAMPLES.md             | ✅ Strong       |
| Specific opinions          | "bilkul nahi" > "I disagree"    | Ayesha has strong voice, Hindi, sarcasm         | ✅ Strong       |
| Resourceful before asking  | "Come back with answers"        | SOUL.md: "Already checked, here's what I found" | ✅ Covered      |
| Permission boundaries      | Read freely, confirm external   | SOUL.md: boundaries section                     | ✅ Covered      |
| Honest opinions with charm | Push back warmly                | SOUL.md: anti-dryness rule, examples            | ✅ Strong       |
| Channel-aware formatting   | Adapt to WhatsApp vs Slack      | Short WhatsApp messages, Telegram Markdown      | ✅ Basic        |
| Pronoun respect            | Cultural sensitivity            | "Aap" rule — non-negotiable                     | ✅ Unique to us |

**Verdict:** Our personality layer is already better than most implementations. The Ayesha IDENTITY/SOUL/EXAMPLES split with specific Hindi/English voice calibration is genuinely strong. Most SOUL.md configs in the wild are generic platitudes — ours has real character.

---

## What We're Missing (Ranked by Impact)

### 1. Scheduled Proactive Communication — HIGH IMPACT

**What others do:** Morning briefing, evening reflection, weekly review — all cron-driven, no user prompt needed.

**Dopamine Digital pattern:**

- **Morning (8 AM):** Calendar + emails + top 3 priorities + deadlines → <150 words to WhatsApp/Telegram
- **Evening (9 PM):** Review completed work + decisions made + ONE reflective question
- **Weekly (Monday 8 AM):** Accomplishments vs goals + patterns + 3 priorities for next week
- **Overnight (2 AM):** Silent research/content scan, results saved to files

**Our gap:** We have a cron scheduler (`scheduler.ts`) but it's unused. The infrastructure is there — we just need to wire it up.

**Cost optimization insight:** Use Haiku for cron jobs (morning scan, content research). Sonnet for reasoning (weekly review). Opus only for rare high-stakes analysis. This saves 60%+ on scheduled tasks.

**Recommendation:** Wire 2-3 cron patterns into the scheduler using existing infrastructure. Start with morning briefing — highest user value, lowest implementation effort.

### 2. Adaptive Tone Matching — MEDIUM IMPACT

**What others do:** ChatGPT is explicitly instructed to "match the user's vibe, tone, and generally how they're speaking." Adapts formality level dynamically.

**Our gap:** Ayesha has a fixed sarcasm level. She's always warm+sarcastic. If the user sends a serious, stressed message at midnight, she still opens with a joke. No adaptation.

**Recommendation:** Add a section to SOUL.md:

```
## Tone Adaptation
- If the user sounds stressed or upset → dial sarcasm to 0%, lead with empathy
- If the user is in a rush (short messages, no punctuation) → match brevity, skip the banter
- If the user is relaxed and chatty → full Ayesha mode, jokes and all
- Default: warm + slightly sarcastic
```

No code change needed — this is purely a CLAUDE.md update.

### 3. Learning Loops / Feedback Capture — MEDIUM IMPACT

**What others do (mberman84):** Capture binary signals — user approves/rejects suggestions, then feed back into future decision-making.

**Our gap:** Every interaction is stateless from a learning perspective. If Ayesha suggests something and the user says "no, never do that", she might suggest it again next session (unless she writes it to memory/ herself).

**Recommendation for v1:** Simple — add to SOUL.md:

```
## Learning
When the user corrects you, gives feedback, or rejects a suggestion:
1. Save a note to memory/feedback.md with what happened and what the user prefers
2. Read memory/feedback.md at the start of each session to avoid repeating mistakes
```

This is file-based learning — no infrastructure change. The agent learns by writing and reading its own notes.

### 4. Conversational Onboarding — MEDIUM IMPACT

**What others do:** Instead of a config form, the agent asks the user about themselves conversationally: name, role, priorities, working style, 12-month vision.

**Our gap:** We set up the agent's identity (CLAUDE.md) but never formally onboard the USER. Ayesha doesn't know Rijul's role, priorities, schedule patterns, or communication preferences unless told incidentally.

**Recommendation:** Add an onboarding prompt to SOUL.md:

```
## First Conversation
If memory/owner-profile.md doesn't exist, start your first conversation by getting to know the user.
Ask conversationally (not a form): their name, role, what they're working on, how they like to communicate,
what "a good day" looks like for them. Save to memory/owner-profile.md.
```

### 5. Context Layering (Hot/Warm/Cold Memory) — LOWER IMPACT FOR NOW

**What PAI does:** Three-tier memory: Hot (last 10 interactions), Warm (recent month), Cold (full history).

**Our current state:** Flat — Claude session history is the only context. Memory files exist but aren't structured.

**Recommendation:** Not needed for v1. Our "workspace as knowledge base" design handles this naturally — agent reads files in memory/, which effectively is warm/cold storage. Claude's session history is hot. No code change needed, just encourage the agent to organize memory/ files with dates.

### 6. Approval Gates for External Actions — LOWER IMPACT

**What mberman84 does:** Read/analyze freely, but gate sends/posts/publishes behind user confirmation.

**Our current state:** We already do this partially — SOUL.md says "When in doubt, ask before acting externally." But it's soft guidance, not enforced. The outbox pattern sends immediately.

**Recommendation:** Add to agent capabilities:

```
When sending a message to a new contact for the first time, always confirm with the user first.
For contacts you've messaged before, send directly unless the message is sensitive.
```

This is behavioral, not architectural. The outbox watcher could add a confirmation step, but the simpler approach is letting the agent's judgment handle it.

### 7. STYLE.md with Good/Bad Output Examples — LOWER IMPACT

**What aaronjmars/soul.md does:** Separate STYLE.md with specific syntax patterns, plus examples/ folder with "good output" and "bad output" samples.

**Our current state:** We already have EXAMPLES.md with "Generic AI says / Ayesha says" pairs. This IS the good/bad calibration.

**Recommendation:** We're already ahead here. No change needed. Could add a few "bad output" examples if the agent starts drifting, but the current format works.

### 8. Priority Hierarchy for Conflicting Instructions — LOWER IMPACT

**What OpenClaw does:**

1. Explicit instructions in current conversation
2. Skill instructions when a skill is active
3. SOUL.md personality and behavior rules
4. AGENTS.md context and identity
5. General good judgment

**Our gap:** No explicit priority hierarchy. If SOUL.md says "be brief" but the user says "give me a detailed analysis", which wins?

**Recommendation:** Add to SOUL.md:

```
## Priority
1. What the user just asked for (always wins)
2. Task-specific instructions (if doing a specific job)
3. These personality rules (SOUL.md, IDENTITY.md)
4. General good judgment
```

### 9. Consciousness Tokens / Data Ingestion — FUTURE

**What aaronjmars/soul.md does:** Ingest user's tweets, essays, conversations as "consciousness tokens" to build personality from real data.

**Our context:** This maps to the future RAG pipeline. When we build `knowledge/` ingestion, the agent could read the user's writing style and adapt.

**Recommendation:** Not for v1. Note for RAG phase: personality can be sharpened by feeding the agent examples of the user's actual writing.

---

## Comparison Matrix

| Component            | Our Ayesha                 | OpenClaw SOUL.md | PAI           | mberman84   | Dopamine Digital    |
| -------------------- | -------------------------- | ---------------- | ------------- | ----------- | ------------------- |
| Identity definition  | ✅ Strong (3 files)        | ✅ Strong        | ✅ (TELOS)    | Minimal     | Minimal             |
| Voice calibration    | ✅ (EXAMPLES.md)           | ✅ (STYLE.md)    | Implicit      | ✗           | ✗                   |
| Hindi/cultural layer | ✅ Unique                  | ✗                | ✗             | ✗           | ✗                   |
| Scheduled comms      | ✗ (infra exists)           | ✗                | ✅ (hooks)    | ✅ (cron)   | ✅ (4 crons)        |
| Tone adaptation      | ✗ Fixed sarcasm            | ✅ Adaptive      | ✅            | ✗           | ✗                   |
| Learning loops       | ✗                          | ✗                | ✅            | ✅          | ✗                   |
| Onboarding flow      | ✗                          | ✅               | ✅            | ✗           | ✗                   |
| Memory tiers         | Flat                       | Session          | Hot/warm/cold | Session+log | Session             |
| Approval gates       | Soft (SOUL.md)             | ✗                | ✅ (hooks)    | ✅          | ✗                   |
| Priority hierarchy   | ✗                          | ✅ (5 levels)    | Implicit      | ✗           | ✗                   |
| Cost optimization    | ✗ Same model               | ✗                | ✗             | ✗           | ✅ (model-per-task) |
| Contact personality  | ✅ (per-contact CLAUDE.md) | ✗                | ✗             | ✗           | ✗                   |
| Security guardrails  | ✅ (block + sandbox)       | ✗                | ✅            | ✗           | ✗                   |

---

## Concrete Next Steps (No Code Changes Needed)

These are all CLAUDE.md updates that immediately improve the agent:

### 1. Add tone adaptation section

```markdown
## Tone Adaptation

- Stressed/upset user → empathy first, sarcasm off
- Rushed user (short messages) → match brevity
- Relaxed/chatty → full Ayesha mode
- Late night → gentler, less energy
- Default: warm + slightly sarcastic
```

### 2. Add learning loop instruction

```markdown
## Learning

When the user corrects you or rejects a suggestion, save a note to memory/feedback.md.
Read memory/feedback.md on each session to avoid repeating mistakes.
```

### 3. Add onboarding trigger

```markdown
## First Conversation

If memory/owner-profile.md doesn't exist, get to know the user conversationally.
Ask about: name, role, priorities, communication preferences, what a good day looks like.
Save to memory/owner-profile.md.
```

### 4. Add priority hierarchy

```markdown
## Priority When Instructions Conflict

1. What the user just asked for (always wins)
2. Task-specific context
3. These personality rules
4. General good judgment
```

### 5. Wire morning briefing cron (code change)

```json
// In cron.json for each user
{
  "cron": "0 8 * * *",
  "task": "Give me a morning briefing: what's on my plate today, any deadlines this week, anything I should know."
}
```

---

## Key Insight

**We're stronger on personality than almost everyone, but weaker on proactive behavior.** Most implementations have bland personalities with sophisticated scheduled communications. We have a great personality with zero proactive outreach. The highest-impact improvement is wiring scheduled briefings — the infrastructure already exists.
