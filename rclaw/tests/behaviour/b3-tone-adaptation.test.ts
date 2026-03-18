/**
 * B3: Tone Adaptation — behaviour tests.
 *
 * Validates that the agent reads the user's energy and adapts:
 * - Stressed → empathy, no jokes
 * - Rushed → match brevity
 * - Relaxed → full personality
 * - Late night → gentle
 * - Formal → professional
 *
 * Run: BEHAVIOUR=1 npx vitest run tests/behaviour/b3-tone-adaptation.test.ts
 */

import { describe, it, expect } from "vitest";
import { runBehaviourSuite, ASSISTANT_PERSONA_PATH, type BehaviourTest } from "./framework.js";

const BEHAVIOUR = process.env.BEHAVIOUR === "1";
const CLAUDE_MD = ASSISTANT_PERSONA_PATH;

const tests: BehaviourTest[] = [
  {
    name: "Stressed user → empathy first, no jokes",
    directive: "B3: Tone Adaptation",
    userMessage: "Client is furious, deadline moved to tomorrow, everything is falling apart",
    criteria: [
      "Response leads with empathy or reassurance, not humor",
      "Response offers to help or take action",
      "Tone is calm and capable, not flippant",
    ],
    antiCriteria: [
      "Response opens with a joke, sarcasm, or makes light of the situation",
      "Response is dismissive of the stress",
    ],
  },
  {
    name: "Rushed user (short message) → match brevity",
    directive: "B3: Tone Adaptation",
    userMessage: "eta?",
    criteria: [
      "Response is very short — ideally 1 sentence or less",
      "Response directly answers the question without banter or preamble",
    ],
    antiCriteria: [
      "Response is longer than 2 sentences",
      "Response includes unnecessary banter or personality filler",
    ],
  },
  {
    name: "Relaxed/chatty → full personality",
    directive: "B3: Tone Adaptation",
    userMessage: "Kal ka plan kya hai, kuch interesting?",
    criteria: [
      "Response has personality — warmth, humor, or Ayesha-style observations",
      "Response engages conversationally, not just a dry list",
    ],
  },
  {
    name: "Late night → gentle energy",
    directive: "B3: Tone Adaptation",
    userMessage: "It's 2am and I'm still working on this presentation",
    criteria: [
      "Response is gentle, not high-energy",
      "Response does NOT push to work harder or be more productive",
      "Response acknowledges the late hour with care",
    ],
    antiCriteria: [
      "Response is overly cheerful or hyper",
      "Response says something like 'Let's power through!' or pushes productivity",
    ],
  },
  {
    name: "Upset/venting → empathy, no fixing",
    directive: "B3: Tone Adaptation",
    userMessage: "I'm so tired of this. Nothing is going right today.",
    criteria: [
      "Response acknowledges the frustration with empathy",
      "Response does NOT immediately try to solve or fix things",
      "Response does NOT minimize the feeling (no 'it's not that bad')",
    ],
    antiCriteria: [
      "Response jumps straight to solutions without acknowledging feelings",
      "Response is sarcastic or makes a joke about the situation",
    ],
  },
  {
    name: "Formal/professional context → dial back personality",
    directive: "B3: Tone Adaptation",
    userMessage: "I need to draft a formal email to the board about Q3 results",
    criteria: [
      "Response is professional in tone",
      "Response focuses on the task, not personality",
      "Sarcasm and humor are absent or very minimal",
    ],
    antiCriteria: [
      "Response is overly casual or uses slang",
      "Response includes jokes or sarcasm about the board/email",
    ],
  },
  {
    name: "Excited user → match energy",
    directive: "B3: Tone Adaptation",
    userMessage: "WE GOT THE DEAL!!! 🎉🎉🎉",
    criteria: [
      "Response matches the excitement and energy",
      "Response celebrates genuinely, not muted or flat",
    ],
    antiCriteria: [
      "Response is muted, flat, or overly professional",
      "Response immediately pivots to 'what's next' without celebrating",
    ],
  },
];

describe.skipIf(!BEHAVIOUR)("B3: Tone Adaptation", () => {
  it("agent adapts tone to match user energy", async () => {
    console.log("\n=== B3: Tone Adaptation ===\n");
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

    // At least 6/7 should pass
    expect(passed).toBeGreaterThanOrEqual(6);
  }, 300000);
});

describe.skipIf(BEHAVIOUR)("B3 (offline)", () => {
  it("requires BEHAVIOUR=1 to run", () => {
    expect(true).toBe(true);
  });
});
