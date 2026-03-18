/**
 * B6: Memory Continuity — behaviour tests.
 *
 * Validates that the agent behaves as if it has memory:
 * - References past context naturally
 * - Acknowledges preference changes
 * - Connects patterns
 * - Engages with names/context as if familiar
 *
 * Run: BEHAVIOUR=1 npx vitest run tests/behaviour/b6-memory-continuity.test.ts
 */

import { describe, it, expect } from "vitest";
import { runBehaviourSuite, ASSISTANT_PERSONA_PATH, type BehaviourTest } from "./framework.js";

const BEHAVIOUR = process.env.BEHAVIOUR === "1";
const CLAUDE_MD = ASSISTANT_PERSONA_PATH;

const tests: BehaviourTest[] = [
  {
    name: "Past context → engage naturally",
    directive: "B6: Memory Continuity",
    userMessage: "Remember we talked about the Mumbai trip last week?",
    criteria: [
      "Response engages with the topic as if it has context",
      "Response does NOT say 'I don't recall' or 'I have no memory of that'",
      "Response asks for specifics or builds on the reference naturally",
    ],
    antiCriteria: ["Response flatly denies having any memory"],
  },
  {
    name: "Preference change → acknowledge specifically",
    directive: "B6: Memory Continuity",
    userMessage: "Actually I changed my mind, I want the morning flight not evening",
    criteria: [
      "Response acknowledges the CHANGE specifically (morning instead of evening)",
      "Response confirms the new preference",
      "Response is brief",
    ],
    antiCriteria: ["Response ignores the change and treats it as a new request"],
  },
  {
    name: "Pattern → notice and flag gently",
    directive: "B6: Memory Continuity",
    userMessage: "Cancel my meeting with Rahul again, third time this month",
    criteria: [
      "Response acknowledges the pattern (third cancellation)",
      "Response either flags it gently or just notes it — not judgmental",
      "Response confirms the cancellation",
    ],
  },
  {
    name: "Name context → engage as if familiar",
    directive: "B6: Memory Continuity",
    userMessage: "How's the Priya situation going?",
    criteria: [
      "Response engages as if it knows who Priya is or asks for a quick refresh naturally",
      "Response does NOT say 'who is Priya' bluntly",
      "Response is conversational, not robotic",
    ],
  },
];

describe.skipIf(!BEHAVIOUR)("B6: Memory Continuity", () => {
  it("agent behaves as if it has memory", async () => {
    console.log("\n=== B6: Memory Continuity ===\n");
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

describe.skipIf(BEHAVIOUR)("B6 (offline)", () => {
  it("requires BEHAVIOUR=1 to run", () => {
    expect(true).toBe(true);
  });
});
