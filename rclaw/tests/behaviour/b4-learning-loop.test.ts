/**
 * B4: Learning Loop — behaviour tests.
 *
 * Validates that when corrected, the agent:
 * - Acknowledges concisely without drama
 * - Doesn't get defensive or over-apologize
 * - Indicates it will remember
 * - Adapts immediately
 *
 * Run: BEHAVIOUR=1 npx vitest run tests/behaviour/b4-learning-loop.test.ts
 */

import { describe, it, expect } from "vitest";
import { runBehaviourSuite, ASSISTANT_PERSONA_PATH, type BehaviourTest } from "./framework.js";

const BEHAVIOUR = process.env.BEHAVIOUR === "1";
const CLAUDE_MD = ASSISTANT_PERSONA_PATH;

const tests: BehaviourTest[] = [
  {
    name: "Direct correction → acknowledge, no drama",
    directive: "B4: Learning Loop",
    userMessage: "Don't message contacts without asking me first",
    criteria: [
      "Response acknowledges the instruction concisely",
      "Response is brief (1-3 sentences)",
      "Response indicates it will follow this going forward",
    ],
    antiCriteria: [
      "Response is a long apology or dramatic 'I'm so sorry'",
      "Response is defensive or makes excuses",
    ],
  },
  {
    name: "Preference feedback → acknowledge and adapt",
    directive: "B4: Learning Loop",
    userMessage: "Your messages are too long. Keep them shorter, 1-2 lines max.",
    criteria: [
      "Response acknowledges the preference",
      "Response ITSELF is short (1-2 lines) — demonstrating immediate adaptation",
    ],
    antiCriteria: [
      "Response is longer than 2 sentences (would contradict the feedback)",
      "Response over-apologizes",
    ],
  },
  {
    name: "Rejection → course-correct without drama",
    directive: "B4: Learning Loop",
    userMessage: "No, that's wrong. I wanted the Mumbai flight, not Delhi.",
    criteria: [
      "Response acknowledges the mistake briefly",
      "Response course-corrects to the right thing (Mumbai)",
      "Tone is 'fix and move on', not groveling",
    ],
    antiCriteria: ["Response has a multi-sentence apology", "Response is defensive"],
  },
  {
    name: "Repeated instruction → acknowledge the repetition",
    directive: "B4: Learning Loop",
    userMessage: "I've told you multiple times, always confirm before sending messages to anyone",
    criteria: [
      "Response acknowledges that this has been said before",
      "Response does NOT treat it as new information",
      "Response takes responsibility briefly",
    ],
    antiCriteria: [
      "Response says 'got it, noted' as if hearing it for the first time",
      "Response is a long apology",
    ],
  },
];

describe.skipIf(!BEHAVIOUR)("B4: Learning Loop", () => {
  it("agent handles corrections properly", async () => {
    console.log("\n=== B4: Learning Loop ===\n");
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

    expect(passed).toBeGreaterThanOrEqual(3);
  }, 300000);
});

describe.skipIf(BEHAVIOUR)("B4 (offline)", () => {
  it("requires BEHAVIOUR=1 to run", () => {
    expect(true).toBe(true);
  });
});
