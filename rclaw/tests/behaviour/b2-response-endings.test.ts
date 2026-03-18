/**
 * B2: Response Endings — behaviour tests.
 *
 * Validates that the agent:
 * - Doesn't pivot to work on casual messages
 * - Allows social questions (Kya haal hai?) but blocks work questions
 * - Confirms simple tasks briefly without over-explaining
 * - Doesn't leak implementation details
 * - Asks specific questions when genuinely needed
 *
 * Run: BEHAVIOUR=1 npx vitest run tests/behaviour/b2-response-endings.test.ts
 */

import { describe, it, expect } from "vitest";
import { runBehaviourSuite, ASSISTANT_PERSONA_PATH, type BehaviourTest } from "./framework.js";

const BEHAVIOUR = process.env.BEHAVIOUR === "1";
const CLAUDE_MD = ASSISTANT_PERSONA_PATH;

const tests: BehaviourTest[] = [
  {
    name: "Casual greeting",
    directive: "B2: Response Endings",
    userMessage: "Hi Ayesha",
    criteria: ["Response is warm", "Response does NOT ask about work or tasks"],
    antiCriteria: ["Response asks what to focus on or work on"],
  },
  {
    name: "Casual chat — mood",
    directive: "B2: Response Endings",
    userMessage: "Just had coffee, feeling good today",
    criteria: ["Response acknowledges warmly", "Response does NOT pivot to work"],
    antiCriteria: ["Response asks about tasks or work"],
  },
  {
    name: "Small talk",
    directive: "B2: Response Endings",
    userMessage: "Delhi mein bahut garmi hai aaj",
    criteria: ["Response engages with weather/Delhi", "Response does NOT pivot to work"],
  },
  {
    name: "Simple task — brief confirmation",
    directive: "B2: Response Endings",
    userMessage: "Remind me to call mom at 6pm",
    criteria: [
      "Response confirms the reminder",
      "Response is brief (1-2 sentences)",
      "No unnecessary caveats or offers",
    ],
    antiCriteria: [
      "Response mentions sessions/tools/technical details",
      "Response is longer than 2 sentences",
    ],
  },
  {
    name: "Late night — no productivity",
    directive: "B2: Response Endings",
    userMessage: "Can't sleep, just scrolling",
    criteria: ["Response is gentle and warm", "Response does NOT suggest work"],
  },
  {
    name: "Existential check-in — social question OK",
    directive: "B2: Response Endings",
    userMessage: "Hiyaaaaa",
    criteria: [
      "Response is warm and playful",
      "Response does NOT ask about work",
      "Social questions like how are you are fine",
    ],
    antiCriteria: ["Response asks what to focus on or work on"],
  },
  {
    name: "Decision needed — specific question OK",
    directive: "B2: Response Endings",
    userMessage: "I need to book a flight to Mumbai next week",
    criteria: ["Response acknowledges request", "Response asks specific clarifying questions"],
  },
  {
    name: "Task done — no 'anything else'",
    directive: "B2: Response Endings",
    userMessage: "Thanks, that worked perfectly",
    criteria: [
      "Response acknowledges warmly",
      "Response does NOT end with 'anything else' or 'kuch aur'",
    ],
    antiCriteria: ["Response asks anything else or offers more"],
  },
];

describe.skipIf(!BEHAVIOUR)("B2: Response Endings", () => {
  it("agent follows response ending rules", async () => {
    console.log("\n=== B2: Response Endings ===\n");
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

    // At least 7/8 should pass (one allowed for LLM non-determinism)
    expect(passed).toBeGreaterThanOrEqual(7);
  }, 300000);
});

describe.skipIf(BEHAVIOUR)("B2 (offline)", () => {
  it("requires BEHAVIOUR=1 to run", () => {
    expect(true).toBe(true);
  });
});
