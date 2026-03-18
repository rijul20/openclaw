/**
 * B5: Context-Aware Brevity — behaviour tests.
 *
 * Validates response length matches context:
 * - Simple questions → 1-2 sentences
 * - Casual → concise
 * - Emoji → ultra short
 * - Multi-part → covers all parts briefly
 * - Detail request → expands if has info, brief if not
 *
 * Run: BEHAVIOUR=1 npx vitest run tests/behaviour/b5-brevity.test.ts
 */

import { describe, it, expect } from "vitest";
import { runBehaviourSuite, ASSISTANT_PERSONA_PATH, type BehaviourTest } from "./framework.js";

const BEHAVIOUR = process.env.BEHAVIOUR === "1";
const CLAUDE_MD = ASSISTANT_PERSONA_PATH;

const tests: BehaviourTest[] = [
  {
    name: "Simple question → short answer",
    directive: "B5: Context-Aware Brevity",
    userMessage: "What time is my next meeting?",
    criteria: [
      "Response is 1-2 sentences max",
      "Response answers directly or says it cannot check",
    ],
    antiCriteria: ["Response is longer than 2 sentences"],
  },
  {
    name: "Casual message → concise",
    directive: "B5: Context-Aware Brevity",
    userMessage: "Lunch kya khaun aaj?",
    criteria: ["Response is 1-3 sentences", "Response is light and conversational"],
    antiCriteria: ["Response is a long paragraph or detailed list"],
  },
  {
    name: "Emoji reaction → ultra short",
    directive: "B5: Context-Aware Brevity",
    userMessage: "👍",
    criteria: ["Response is very short — 1 sentence or less, or just an emoji/acknowledgment"],
    antiCriteria: ["Response is longer than 1 sentence"],
  },
  {
    name: "Multi-part question → covers all, still brief",
    directive: "B5: Context-Aware Brevity",
    userMessage: "Weather kaisa hai, koi meetings hain aaj, aur remind me to buy groceries",
    criteria: [
      "Response addresses all three parts",
      "Response is concise — max 4-5 sentences total, no filler openers",
    ],
    antiCriteria: [
      "Response has filler lines like complimenting efficiency",
      "Response exceeds 5 sentences",
    ],
  },
  {
    name: "Detail request → expand or explain briefly",
    directive: "B5: Context-Aware Brevity",
    userMessage:
      "Give me a detailed summary of what we discussed yesterday about the product launch",
    criteria: [
      "If agent has the info: response is detailed and structured",
      "If agent does not have the info: communicates that clearly in 1-3 sentences",
    ],
  },
];

describe.skipIf(!BEHAVIOUR)("B5: Context-Aware Brevity", () => {
  it("agent adapts response length to context", async () => {
    console.log("\n=== B5: Context-Aware Brevity ===\n");
    const results = await runBehaviourSuite(CLAUDE_MD, tests, true);

    const passed = results.filter((r) => r.judgement.pass).length;
    const total = results.length;
    console.log(`\n=== Results: ${passed}/${total} passed ===\n`);

    for (const r of results) {
      if (!r.judgement.pass) {
        console.log(`FAILED: ${r.test.name}`);
        console.log(`  Response: "${r.agentResponse}"`);
        for (const c of r.judgement.criteriaResults) {
          if (!c.pass) {
            console.log(`  Failed: ${c.criterion} — ${c.reason}`);
          }
        }
      }
    }

    expect(passed).toBeGreaterThanOrEqual(4);
  }, 300000);
});

describe.skipIf(BEHAVIOUR)("B5 (offline)", () => {
  it("requires BEHAVIOUR=1 to run", () => {
    expect(true).toBe(true);
  });
});
