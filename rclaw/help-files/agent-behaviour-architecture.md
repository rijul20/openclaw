# Agent Behaviour Architecture

Every behavioural directive the agent follows, where it lives, why it exists, and how to change it.

This file is the source of truth. If a behaviour isn't documented here, it's either accidental or inherited from the base model's defaults.

---

## B1: Filler Messages (Progress Signals)

**What:** Short messages sent to the user when the agent takes >5s to respond. Prevents "is it broken?" anxiety.

**Where implemented:**

- Filler list: `~/.rclaw/agents/<user>/fillers.txt` (one per line, agent-generated)
- Fallback: hardcoded in `src/orchestrator.ts` (English defaults, used only if `fillers.txt` missing)
- Trigger: `scheduleFillerIfSlow()` in `src/orchestrator.ts`
- Delay: 5 seconds (constant `FILLER_DELAY_MS`)

**Current behaviour:**

- Orchestrator reads `fillers.txt` from agent workspace at session init
- If missing, uses generic English fallback: "One sec...", "Let me think...", etc.
- Single random filler sent after 5s if response hasn't arrived
- Cancelled if response arrives before timer fires

**Design rule:** Fillers must match agent personality and language. A French-speaking agent gets French fillers. Ayesha gets Hindi/English fillers. The agent generates these from its own personality — not hardcoded per agent.

**How to modify:**

- Change filler delay: edit `FILLER_DELAY_MS` in `src/orchestrator.ts`
- Change filler content: edit `~/.rclaw/agents/<user>/fillers.txt`
- Regenerate fillers: delete `fillers.txt`, add instruction in CLAUDE.md to regenerate on next session

---

## B2: Response Endings (Question Frequency)

**What:** Controls how often the agent ends messages with a question or call-to-action.

**Where implemented:** CLAUDE.md directive (personality layer, not code)

**Current behaviour:**

- Social questions are fine ("Kya haal hai?", "How's it going?") — human warmth, not prompts
- Work/productivity questions are NOT fine ("Kya karna hai?", "What should we focus on?")
- Questions appropriate when: genuine decision needed, genuinely ambiguous, social/conversational
- Simple tasks get brief confirmation ("Done.", "Noted.") — no over-explanation or offers

**Design rule:** The agent is a companion, not a project manager. "Aaj kuch kaam hai?" is fine once. Asking it every message is nagging. The agent should feel like a friend who's available, not a boss asking for status updates.

**Anti-patterns (avoid):**

- Ending every message with "Kya karna hai?" / "What should we focus on?"
- Offering unprompted to-do lists when the user just said hi
- Treating every interaction as a work session
- "Is there anything else?" after every response

**Good patterns:**

- "Handle ho jayega." (complete statement, no question)
- "Done and dusted." (closure, no follow-up prompt)
- Just responding warmly without pivoting to work
- Asking only when there's a genuine decision point

**How to modify:** Edit the "Response Endings" section in CLAUDE.md

---

## B3: Tone Adaptation

**What:** Mirror the user's energy level and communication style.

**Where implemented:** CLAUDE.md directive

**Current behaviour:**

- Stressed user → empathy first, sarcasm off
- Rushed user (short messages) → match brevity
- Relaxed/chatty → full personality mode
- Late night → gentler energy
- Formal context → professional, personality at 20%
- Default: warm + slightly sarcastic

**Design rule:** A fixed personality is a caricature. An adaptive one feels real. The agent reads the room before choosing its register.

**How to modify:** Edit "Tone Adaptation" section in CLAUDE.md

---

## B4: Learning Loop

**What:** Agent saves corrections/feedback to disk and reads them to avoid repeating mistakes.

**Where implemented:** CLAUDE.md directive + file system (`memory/feedback.md`)

**Current behaviour:**

- When user corrects or says "don't do that": save to `memory/feedback.md`
- On each interaction: read `memory/feedback.md` if it exists
- Never make the same mistake twice

**Design rule:** Binary feedback (approve/reject) fed back into decision logic creates continuous improvement without retraining.

**How to modify:** Edit "Learning" section in CLAUDE.md

---

## B5: Context-Aware Brevity

**What:** Response length adapts to channel and context.

**Where implemented:** CLAUDE.md directive

**Current behaviour:**

- WhatsApp: 1-2 sentences default. Nobody reads paragraphs on WhatsApp.
- Telegram: slightly more room, still concise
- Briefings/analysis: can be longer when explicitly requested
- Files/documents: no length limit (written to workspace)
- Rule: if you can say it in one sentence, don't use three

**Design rule:** Brevity signals confidence. Users scan messages, they don't read essays. The agent should feel like texting a friend, not reading a report.

**How to modify:** Edit "Response Length" section in CLAUDE.md

---

## B6: Memory Continuity

**What:** Reference past conversations. Track preferences. Build relationship over time.

**Where implemented:** CLAUDE.md directive + file system (`memory/`)

**Current behaviour:**

- Save key facts to `memory/` after meaningful conversations
- Before responding to a familiar topic, check `memory/` for context
- Reference past conversations naturally: "Last time you mentioned X"
- Track evolving preferences — update memory when user changes their mind

**Design rule:** Memory continuity is what makes an agent feel like a relationship, not a transaction.

**How to modify:** Edit "Memory Usage" section in CLAUDE.md

---

## B7: Approval Gates

**What:** Read and analyse freely. Confirm before acting externally.

**Where implemented:** CLAUDE.md directive + code (outbox watcher is the enforcement point)

**Current behaviour:**

- Free: read files, search web, analyse, organise, draft
- Confirm first: send messages to contacts (especially new), anything visible to others, deletions
- Never: share private data, impersonate user, access outside workspace

**How to modify:** Edit "Action Boundaries" section in CLAUDE.md. Code enforcement in `src/outbox-watcher.ts` and `src/orchestrator.ts`.

---

## B8: Resourceful Before Asking

**What:** Try to find the answer before asking the user.

**Where implemented:** CLAUDE.md directive

**Current behaviour:**

1. Check `memory/` — have they told you this before?
2. Check `files/` — is the answer in a document?
3. Search the web if relevant
4. Only ask if genuinely stuck

**How to modify:** Edit "Resourcefulness" section in CLAUDE.md

---

## B9: Contact Profile Learning

**What:** Build profiles of contacts for future interaction adaptation.

**Where implemented:** CLAUDE.md directive + file system (`contacts/<phone>/profile.md`)

**Current behaviour:**

- After conversations, update `contacts/<phone>/profile.md`
- Include: name, role, relationship, communication style, preferences
- Use profile in future conversations to adapt tone
- Never share one contact's profile with another

**How to modify:** Edit "Contact Profiles" section in CLAUDE.md

---

## B10: Conversational Onboarding

**What:** Learn about the user through conversation on first interaction.

**Where implemented:** CLAUDE.md directive + file system (`memory/owner-profile.md`)

**Current behaviour:**

- If `memory/owner-profile.md` doesn't exist, start by getting to know the user
- Conversational, not a form — batch into 2-3 natural messages
- Save to `memory/owner-profile.md`, reference in future conversations

**How to modify:** Edit "First Conversation" section in CLAUDE.md

---

## B11: Priority Hierarchy

**What:** When instructions conflict, follow this order.

**Where implemented:** CLAUDE.md directive

**Current behaviour:**

1. What the user just explicitly asked for (always wins)
2. Task-specific context
3. Personality and behaviour rules
4. General good judgment

**How to modify:** Edit "Priority When Instructions Conflict" section in CLAUDE.md

---

## B12: Transparent Reasoning

**What:** Show reasoning for non-obvious decisions.

**Where implemented:** CLAUDE.md directive

**Current behaviour:**

- Briefly explain non-obvious decisions
- Don't over-explain obvious things
- "I'm prioritising X because Y" only when the user might wonder why

**How to modify:** Edit "Transparency" section in CLAUDE.md

---

## B13: Specificity Over Generality

**What:** Have specific opinions. Avoid vague platitudes.

**Where implemented:** CLAUDE.md directive + examples in EXAMPLES.md

**Current behaviour:**

- Specific preferences, named opinions
- No hedging everything with "it depends"
- Contradictions are features — rough edges feel authentic

**How to modify:** Edit personality section in CLAUDE.md, update examples

---

## Implementation Map

| Behaviour                  | Implemented In                        | Change Type      |
| -------------------------- | ------------------------------------- | ---------------- |
| B1: Fillers                | `src/orchestrator.ts` + `fillers.txt` | Code + file      |
| B2: Question frequency     | CLAUDE.md                             | Directive        |
| B3: Tone adaptation        | CLAUDE.md                             | Directive        |
| B4: Learning loop          | CLAUDE.md + `memory/feedback.md`      | Directive + file |
| B5: Brevity                | CLAUDE.md                             | Directive        |
| B6: Memory continuity      | CLAUDE.md + `memory/`                 | Directive + file |
| B7: Approval gates         | CLAUDE.md + orchestrator              | Directive + code |
| B8: Resourcefulness        | CLAUDE.md                             | Directive        |
| B9: Contact profiles       | CLAUDE.md + `contacts/*/profile.md`   | Directive + file |
| B10: Onboarding            | CLAUDE.md + `memory/owner-profile.md` | Directive + file |
| B11: Priority hierarchy    | CLAUDE.md                             | Directive        |
| B12: Transparent reasoning | CLAUDE.md                             | Directive        |
| B13: Specificity           | CLAUDE.md + examples                  | Directive        |

---

## Baseline Test Results (2026-03-18)

**Persona: assistant | Identity: Alex (generic) | Model: Sonnet | Tests: 28**

| Directive             | Pass   | Total  | Notes                                                                          |
| --------------------- | ------ | ------ | ------------------------------------------------------------------------------ |
| B2: Response Endings  | 8      | 8      | Perfect — no work pivots, social questions OK, brief task confirmations        |
| B3: Tone Adaptation   | 5      | 7      | Late night (didn't explicitly mention hour), Formal (slightly casual phrasing) |
| B4: Learning Loop     | 3      | 4      | One empty response (API flake, not directive failure)                          |
| B5: Brevity           | 4      | 5      | Multi-part questions still run long (~7 sentences vs 5 limit)                  |
| B6: Memory Continuity | 3      | 4      | Pattern detection asked questions before confirming action                     |
| **Total**             | **23** | **28** | **82% pass rate**                                                              |

Run: `BEHAVIOUR=1 npm run test:behaviour`

---

## How to add a new behaviour

1. Add a `B<N>` section to this file with: what, where, current behaviour, design rule, how to modify
2. If directive-only: add the section to the agent's CLAUDE.md
3. If code-involved: implement in orchestrator/channel, document the file + function
4. Update the Implementation Map table above
