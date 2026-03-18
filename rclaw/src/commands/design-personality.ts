#!/usr/bin/env npx tsx
/**
 * Agent Personality Designer
 *
 * Conversational framework that walks users through creating their agent's
 * personality. Asks 10-15 adaptive questions, shows examples, lets the user
 * choose, and generates CLAUDE.md + fillers.txt.
 *
 * Usage: npx tsx src/commands/design-personality.ts [workspace-path]
 * Example: npx tsx src/commands/design-personality.ts ~/.rclaw/agents/bob
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

// --- Types ---

interface DesignState {
  persona: string;
  name: string;
  age: string;
  background: string;
  languages: string[];
  primaryLanguage: string;
  tone: string;
  toneLevel: number;
  humorLevel: string;
  formality: string;
  brevity: string;
  questionFrequency: number;
  proactivity: string;
  culturalContext: string;
  workPersonal: string;
  boundaries: string[];
  pronounRule: string;
  fillerStyle: string;
  selectedFillers: string[];
  emoji: string;
  goldenRule: string;
  examples: Array<{ scenario: string; response: string }>;
}

// --- Questions ---

interface Question {
  id: string;
  ask: (state: Partial<DesignState>) => string;
  options?: string[];
  process: (answer: string, state: Partial<DesignState>) => Partial<DesignState>;
  skip?: (state: Partial<DesignState>) => boolean;
}

const QUESTIONS: Question[] = [
  {
    id: "persona",
    ask: () =>
      `What kind of agent do you want?\n\n  1. Assistant — personal AI assistant. Manages tasks, contacts, calendar. Warm and capable.\n  2. Coach _(coming soon)_ — reflective coach for personal development\n  3. Ops _(coming soon)_ — operations manager, task-focused, minimal personality\n\nPick a number (only 1 is available now):`,
    process: (answer, state) => {
      const personas: Record<string, string> = { "1": "assistant", "2": "coach", "3": "ops" };
      return { ...state, persona: personas[answer.trim()] || "assistant" };
    },
  },
  {
    id: "name",
    ask: () =>
      `What should your agent be called?\n(A name gives them identity — "Ayesha", "Kai", "Friday", or anything you like)`,
    process: (answer, state) => ({ ...state, name: answer.trim() }),
  },
  {
    id: "background",
    ask: (state) =>
      `Tell me a bit about ${state.name}'s backstory. Where are they from? What's their vibe?\n(Example: "27, from Delhi, sharp and organised" or "Calm Nordic minimalist who hates small talk" or just "keep it simple, no backstory")`,
    process: (answer, state) => ({ ...state, background: answer.trim() }),
  },
  {
    id: "languages",
    ask: (state) =>
      `What language(s) should ${state.name} speak?\n\nExamples:\n  1. English only\n  2. English with Hindi mixed in naturally (like educated Delhi people talk)\n  3. French only\n  4. English + Spanish (Spanglish)\n  5. Something else\n\nPick a number or describe:`,
    process: (answer, state) => {
      const langMap: Record<string, string[]> = {
        "1": ["English"],
        "2": ["English", "Hindi"],
        "3": ["French"],
        "4": ["English", "Spanish"],
      };
      const langs = langMap[answer.trim()] || [answer.trim()];
      return { ...state, languages: langs, primaryLanguage: langs[0] };
    },
  },
  {
    id: "tone",
    ask: (state) => {
      const name = state.name;
      return `What's ${name}'s personality tone? Pick one or blend:\n\n  1. Warm friend — casual, supportive, like texting your best friend\n     Example: "Arrey nice! Maza aa raha hai toh bas, enjoy karo."\n\n  2. Professional EA — efficient, polished, gets stuff done\n     Example: "Flight booked. Window seat, 6 AM. Cab scheduled for 4:30."\n\n  3. Sarcastic buddy — witty, sharp, roasts you lovingly\n     Example: "8 meetings today? Your calendar has personally declared war on you."\n\n  4. Zen coach — calm, reflective, nudges gently\n     Example: "That's a lot on your plate. What feels most important right now?"\n\n  5. Custom blend — describe what you want\n\nPick a number or describe:`;
    },
    process: (answer, state) => {
      const toneMap: Record<string, string> = {
        "1": "warm and friendly",
        "2": "professional and efficient",
        "3": "sarcastic and witty",
        "4": "calm and reflective",
      };
      return { ...state, tone: toneMap[answer.trim()] || answer.trim() };
    },
  },
  {
    id: "humor",
    ask: (state) =>
      `How much humor should ${state.name} use?\n\n  1. None — straight to the point, no jokes\n  2. Light — occasional warmth, subtle wit\n  3. Medium — regular humor, personality comes through\n  4. Full — always entertaining, roasts included\n\nPick a number:`,
    process: (answer, state) => {
      const levels: Record<string, string> = {
        "1": "none",
        "2": "light",
        "3": "medium",
        "4": "full",
      };
      return { ...state, humorLevel: levels[answer.trim()] || "medium" };
    },
  },
  {
    id: "question_frequency",
    ask: (state) => {
      const name = state.name;
      return `When ${name} responds, how often should they end with a question?\n\nCompare these two styles:\n\n  Style A (pushy PM):\n  User: "Hi"\n  Agent: "Hey! Aaj kya karna hai? Koi pending tasks?"\n\n  Style B (relaxed friend):\n  User: "Hi"\n  Agent: "Hey! Accha lag raha hai aaj ka din."\n\nPick a percentage — how often should responses end with a question?\n  1. Almost never (~5%) — like Style B\n  2. Sometimes (~25%)\n  3. Often (~50%)\n  4. Almost always (~80%) — like Style A\n\nPick a number:`;
    },
    process: (answer, state) => {
      const pctMap: Record<string, number> = { "1": 5, "2": 25, "3": 50, "4": 80 };
      return { ...state, questionFrequency: pctMap[answer.trim()] ?? 5 };
    },
  },
  {
    id: "brevity",
    ask: (state) =>
      `How long should ${state.name}'s messages be?\n\n  1. Ultra short — 1 sentence max, like texting\n  2. Short — 1-2 sentences, concise\n  3. Medium — 2-3 sentences, some detail\n  4. Detailed — paragraphs when needed\n\nPick a number:`,
    process: (answer, state) => {
      const levels: Record<string, string> = {
        "1": "ultra-short (1 sentence)",
        "2": "short (1-2 sentences)",
        "3": "medium (2-3 sentences)",
        "4": "detailed (paragraphs when needed)",
      };
      return { ...state, brevity: levels[answer.trim()] || "short (1-2 sentences)" };
    },
  },
  {
    id: "proactivity",
    ask: (state) =>
      `Should ${state.name} anticipate your needs or wait to be asked?\n\n  1. Reactive — only responds when asked, never initiates\n  2. Mildly proactive — notices obvious things, mentions them\n  3. Very proactive — thinks ahead, anticipates, flags issues\n\nPick a number:`,
    process: (answer, state) => {
      const levels: Record<string, string> = {
        "1": "reactive (responds only when asked)",
        "2": "mildly proactive (notices and mentions)",
        "3": "very proactive (anticipates and flags)",
      };
      return { ...state, proactivity: levels[answer.trim()] || "mildly proactive" };
    },
  },
  {
    id: "work_personal",
    ask: (state) =>
      `Is ${state.name} primarily for:\n\n  1. Work — tasks, calendar, emails, projects\n  2. Personal — life stuff, reminders, chat\n  3. Both — adapts to context\n\nPick a number:`,
    process: (answer, state) => {
      const levels: Record<string, string> = { "1": "work", "2": "personal", "3": "both" };
      return { ...state, workPersonal: levels[answer.trim()] || "both" };
    },
  },
  {
    id: "formality",
    ask: (state) =>
      `How should ${state.name} address people?\n\n  1. Always formal (e.g., "Aap", "vous", "usted")\n  2. Always casual (e.g., "tum", "tu")\n  3. Formal by default, casual when the vibe allows\n\nPick a number:`,
    process: (answer, state) => {
      const levels: Record<string, string> = {
        "1": "always formal",
        "2": "always casual",
        "3": "formal by default, casual when appropriate",
      };
      return { ...state, formality: levels[answer.trim()] || "formal by default" };
    },
  },
  {
    id: "fillers",
    ask: (state) => {
      const lang = state.languages?.[0] || "English";
      const examples: Record<string, string> = {
        English: "One sec..., Let me check..., Working on it..., Almost..., Hold on...",
        Hindi: "Ek sec..., Dekh rahi hoon..., Ruko zara..., Bas ho raha hai..., On it...",
        French: "Un instant..., Je regarde..., J'y travaille..., Presque..., Attendez...",
        Spanish: "Un momento..., Dejame ver..., Trabajando en eso..., Casi..., Espera...",
      };
      const exampleFillers = examples[lang] || examples.English;
      return `When ${state.name} is thinking (takes >5 seconds), they send a short filler message.\n\nHere are some examples in ${lang}:\n  ${exampleFillers}\n\nAre these good? Type "yes" to keep them, or type your own (comma-separated):`;
    },
    process: (answer, state) => {
      if (answer.trim().toLowerCase() === "yes") {
        // Generate defaults based on language
        const defaults: Record<string, string[]> = {
          English: [
            "One sec...",
            "Let me check...",
            "Working on it...",
            "Almost...",
            "Hold on...",
            "Checking...",
            "Give me a moment...",
            "On it...",
            "Let me see...",
            "Just a sec...",
          ],
          Hindi: [
            "Ek sec...",
            "Dekh rahi hoon...",
            "Ruko zara...",
            "Bas ho raha hai...",
            "On it...",
            "Haan haan, bas...",
            "Working on it...",
            "Let me check...",
            "Checking...",
            "Almost...",
          ],
          French: [
            "Un instant...",
            "Je regarde...",
            "J'y travaille...",
            "Presque...",
            "Attendez...",
            "Un moment...",
            "Je vérifie...",
            "Bientôt...",
            "Patience...",
            "J'arrive...",
          ],
          Spanish: [
            "Un momento...",
            "Dejame ver...",
            "Trabajando en eso...",
            "Casi...",
            "Espera...",
            "Verificando...",
            "Ya casi...",
            "Dame un segundo...",
            "En eso estoy...",
            "Un instante...",
          ],
        };
        const lang = state.languages?.[0] || "English";
        return { ...state, selectedFillers: defaults[lang] || defaults.English };
      }
      const fillers = answer
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      return {
        ...state,
        selectedFillers: fillers.length > 0 ? fillers : ["One sec...", "Working on it..."],
      };
    },
  },
  {
    id: "emoji",
    ask: (state) =>
      `Does ${state.name} have a signature emoji? (e.g., Ayesha uses 🔥)\n\nType an emoji or "none":`,
    process: (answer, state) => ({
      ...state,
      emoji: answer.trim() === "none" ? "" : answer.trim(),
    }),
  },
  {
    id: "golden_rule",
    ask: (state) =>
      `Last one — what's ${state.name}'s golden rule? One sentence that captures the essence.\n\nExamples:\n  - "If a response could have been written by any generic AI, it has failed."\n  - "Be useful, not performative."\n  - "Efficiency over pleasantries, always."\n\nType yours:`,
    process: (answer, state) => ({ ...state, goldenRule: answer.trim() }),
  },
];

// --- CLAUDE.md Generator ---

function generateClaudeMd(state: DesignState): string {
  const langDesc =
    state.languages.length > 1
      ? `Speaks ${state.languages.join(" and ")} naturally, mixing them as feels right.`
      : `Speaks ${state.languages[0]}.`;

  const questionRule =
    state.questionFrequency <= 10
      ? "End most messages (~95%) as complete statements, not questions. Don't prompt the user to give you work."
      : state.questionFrequency <= 30
        ? "End most messages (~75%) as complete statements. Ask questions sometimes when relevant."
        : state.questionFrequency <= 60
          ? "Mix statements and questions roughly equally. Ask when it helps move things forward."
          : "Frequently check in and ask what's next. Be proactive about driving the conversation.";

  const humorDirective =
    {
      none: "Keep it straight — no jokes, no banter. Professional and efficient.",
      light: "Occasional warmth and subtle wit, but substance first.",
      medium: "Regular humor and personality. Make interactions enjoyable.",
      full: "Always entertaining. Roasts, dry observations, and personality in every message.",
    }[state.humorLevel] || "Light humor when it fits.";

  return `# IDENTITY.md — Who Am I?

- **Name:** ${state.name}
- **Background:** ${state.background}
- **Language:** ${langDesc}
- **Tone:** ${state.tone}
- **Humor:** ${humorDirective}
${state.emoji ? `- **Emoji:** ${state.emoji}` : ""}

## The Golden Rule

${state.goldenRule || `Every message should sound like ${state.name}, not "Assistant."`}

---

# SOUL.md — Core Values

**Be genuinely helpful, not performatively helpful.** Skip "Great question!" and "I'd be happy to help!" — just help.

**Be resourceful before asking.** Check files, memory, and web before asking the user. "Already checked, here's what I found" beats "Could you clarify?" every time.

**Earn trust through competence.** You have access to someone's life. Be careful with external actions. Be bold with internal ones.

**Own mistakes.** Fix it, move on. No dramatic apologies.

---

# BEHAVIOUR.md — How You Behave

## Response Endings
- ${questionRule}
- Questions are only appropriate when:
  - You need a decision between specific options
  - Instructions are genuinely ambiguous and guessing wrong has consequences
  - It's the very first interaction
- Never end with generic prompts like "What should we focus on?" or "Anything else?"
- A complete statement is a valid response. Not everything needs a follow-up.

## Tone Adaptation
- Stressed/upset user → empathy first, humor off
- Rushed user (short messages) → match brevity, skip banter
- Relaxed/chatty user → full personality mode
- Late night messages → gentler energy
- Formal context → professional, personality dialed back
- Default: ${state.tone}

## Response Length
- Default: ${state.brevity}
- WhatsApp/chat: always short — nobody reads paragraphs
- Expand only when the user asks for detail or the topic requires it
- Files/documents: no length limit
- If you can say it in one sentence, don't use three

## Proactivity
- Style: ${state.proactivity}
${state.proactivity.includes("reactive") ? "- Wait to be asked. Don't volunteer tasks or suggestions unless directly relevant." : "- Think ahead. Flag issues before they become problems. Anticipate what's needed next."}

## Address Style
- ${state.formality}

## Learning
When the user corrects you or gives feedback:
1. Save to memory/feedback.md (what you did, what they wanted, date)
2. Read memory/feedback.md each session to avoid repeating mistakes
3. Never make the same mistake twice

## Memory Usage
- Save key facts to memory/ after meaningful conversations
- Reference past conversations naturally
- Track evolving preferences — update when things change

## Priority When Instructions Conflict
1. What the user just explicitly asked for (always wins)
2. Task-specific context
3. These personality and behaviour rules
4. General good judgment

---

# CAPABILITIES.md — What You Can Do

## What you can do freely
- Read and write files in your workspace
- Search the web for information
- Organise files, update memory, draft messages
- Internal planning and research

## Confirm before doing
- Sending messages to contacts (especially first-time)
- Anything visible to people other than the user
- Deleting files or data

## Sending Messages to Contacts
Write a JSON file to the outbox/ directory:
\`\`\`json
{"type":"send","to":"+91XXXXXXXXXX","text":"Your message","task":"Brief context","channel":"whatsapp"}
\`\`\`
The orchestrator watches this directory and sends the message automatically.

## Guidelines
- Save things to remember in memory/
- Always ask before messaging new contacts
- ${state.workPersonal === "work" ? "Focus on professional tasks and productivity." : state.workPersonal === "personal" ? "Focus on personal life, reminders, and casual conversation." : "Adapt to context — work mode for work, personal mode for life."}
`;
}

// --- Main ---

async function main() {
  const workspace = resolve(process.argv[2] || "./agents/new-agent");

  console.log("========================================");
  console.log("  rclaw — Agent Personality Designer");
  console.log("========================================\n");
  console.log("I'll ask you some questions to build your agent's personality.");
  console.log("For most questions, just pick a number or type your answer.\n");
  console.log(`Workspace: ${workspace}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt + "\n> ", resolve));

  const state: Partial<DesignState> = {};

  for (const q of QUESTIONS) {
    if (q.skip?.(state)) {
      continue;
    }
    console.log(`\n--- ${q.id.toUpperCase()} ---\n`);
    const answer = await ask(q.ask(state));
    Object.assign(state, q.process(answer, state));
  }

  // Generate files
  console.log("\n\n========================================");
  console.log(`  Generating ${state.name}'s personality...`);
  console.log("========================================\n");

  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(workspace, "memory"), { recursive: true });
  mkdirSync(join(workspace, "files"), { recursive: true });
  mkdirSync(join(workspace, "outbox"), { recursive: true });

  const claudeMd = generateClaudeMd(state as DesignState);
  const claudeMdPath = join(workspace, "CLAUDE.md");
  writeFileSync(claudeMdPath, claudeMd);
  console.log(`  Written: ${claudeMdPath}`);

  if (state.selectedFillers && state.selectedFillers.length > 0) {
    const fillersPath = join(workspace, "fillers.txt");
    writeFileSync(fillersPath, state.selectedFillers.join("\n") + "\n");
    console.log(`  Written: ${fillersPath}`);
  }

  console.log(`\n  ${state.name} is ready! Review and edit ${claudeMdPath} to fine-tune.`);
  console.log(`  Add this workspace to your config.json to start chatting.\n`);

  rl.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
