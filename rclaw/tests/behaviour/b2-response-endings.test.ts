/**
 * B2: Response Endings — behaviour tests.
 *
 * Validates that the agent ends most messages as complete statements,
 * not questions. Uses real Sonnet to generate + judge responses.
 *
 * Run: BEHAVIOUR=1 npx vitest run tests/behaviour/b2-response-endings.test.ts
 */

import { describe, it, expect } from "vitest";
import { runBehaviourSuite, type BehaviourTest } from "./framework.js";

const BEHAVIOUR = process.env.BEHAVIOUR === "1";
const CLAUDE_MD = "/Users/rijul/.rclaw/agents/alice/CLAUDE.md";

const tests: BehaviourTest[] = [
  {
    name: "Casual greeting → no work pivot",
    directive: "B2: Response Endings",
    userMessage: "Hi Ayesha",
    criteria: [
      "Response is a warm, casual greeting",
      "Response does NOT end with a question about work or tasks",
      "Response does NOT ask what the user wants to focus on or work on",
      "Response feels like a friend saying hi, not a project manager starting a standup",
    ],
    antiCriteria: [
      "Response ends with 'Kya karna hai?' or 'What should we work on?' or similar",
      "Response pivots to productivity or to-do lists",
    ],
  },
  {
    name: "Casual chat → complete statement ending",
    directive: "B2: Response Endings",
    userMessage: "Just had coffee, feeling good today",
    criteria: [
      "Response acknowledges the mood warmly",
      "Response ends as a complete statement, not a question",
      "Response does NOT ask what work to do next",
    ],
    antiCriteria: [
      "Response ends with a question",
      "Response asks about tasks, work, or what to focus on",
    ],
  },
  {
    name: "Simple task → question only if genuinely needed",
    directive: "B2: Response Endings",
    userMessage: "Remind me to call mom at 6pm",
    criteria: [
      "Response confirms the reminder is set",
      "Response ends as a statement (e.g. 'Done' or 'Set'), OR asks only if there's genuine ambiguity (timezone, which number)",
      "Response is brief (1-3 sentences)",
    ],
  },
  {
    name: "Late night message → no productivity push",
    directive: "B2: Response Endings",
    userMessage: "Can't sleep, just scrolling",
    criteria: [
      "Response is gentle and warm (late night energy)",
      "Response does NOT suggest work tasks or productivity",
      "Response ends as a complete statement, not a question about what to do",
    ],
    antiCriteria: [
      "Response suggests working on something",
      "Response asks 'anything I can help with?' or similar",
    ],
  },
  {
    name: "Decision needed → question is appropriate",
    directive: "B2: Response Endings",
    userMessage: "I need to book a flight to Mumbai next week",
    criteria: [
      "Response acknowledges the request",
      "Response asks a question — this is appropriate because dates/preferences are genuinely ambiguous",
      "The question is specific (dates, airline preference, budget) not generic ('what should we do?')",
    ],
  },
];

describe.skipIf(!BEHAVIOUR)("B2: Response Endings", () => {
  it("agent follows response ending rules", async () => {
    console.log("\n=== B2: Response Endings ===\n");
    const results = await runBehaviourSuite(CLAUDE_MD, tests);

    const passed = results.filter((r) => r.judgement.pass).length;
    const total = results.length;
    console.log(`\n=== Results: ${passed}/${total} passed ===\n`);

    // Print detailed results
    for (const r of results) {
      if (!r.judgement.pass) {
        console.log(`FAILED: ${r.test.name}`);
        console.log(`  Response: "${r.agentResponse}"`);
        for (const c of r.judgement.criteriaResults) {
          if (!c.pass) {
            console.log(`  Failed criterion: ${c.criterion} — ${c.reason}`);
          }
        }
      }
    }

    // At least 4/5 should pass (allowing for LLM non-determinism)
    expect(passed).toBeGreaterThanOrEqual(4);
  }, 300000); // 5 min — 5 tests × 2 LLM calls each
});

describe.skipIf(BEHAVIOUR)("B2 (offline)", () => {
  it("requires BEHAVIOUR=1 to run", () => {
    expect(true).toBe(true);
  });
});
