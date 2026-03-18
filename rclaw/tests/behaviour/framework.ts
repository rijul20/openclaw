/**
 * Behaviour test framework.
 *
 * Sends test messages through real Claude (Sonnet) with the agent's CLAUDE.md
 * personality, captures responses, then uses a separate judge prompt to evaluate
 * whether the response meets behavioural criteria.
 *
 * Usage: BEHAVIOUR=1 npx vitest run tests/behaviour/
 */

import { readFileSync } from "node:fs";

const CLAUDE_BINARY = "/Users/rijul/.local/share/claude/versions/2.1.77";

// Default persona template for testing (tests validate directives, not personal identity)
export const ASSISTANT_PERSONA_PATH = new URL("../../personas/assistant/CLAUDE.md", import.meta.url)
  .pathname;

/**
 * Resolve persona template placeholders with a generic test identity.
 * Tests validate directives, not personal identity — so we use neutral defaults.
 */
export function resolvePersonaTemplate(template: string): string {
  return template
    .replace(/\{\{AGENT_NAME\}\}/g, "Alex")
    .replace(/\{\{AGENT_BACKGROUND\}\}/g, "A capable, warm AI assistant")
    .replace(/\{\{AGENT_LANGUAGES\}\}/g, "English")
    .replace(/\{\{AGENT_TONE\}\}/g, "Warm and friendly with light humor")
    .replace(/\{\{AGENT_HUMOR\}\}/g, "Light humor when it fits")
    .replace(/\{\{AGENT_FORMALITY\}\}/g, "Formal by default, casual when appropriate")
    .replace(/\{\{AGENT_EMOJI\}\}/g, "")
    .replace(
      /\{\{GOLDEN_RULE[^}]*\}\}/g,
      "Every message should sound like a real person, not a chatbot.",
    );
}

export interface BehaviourTest {
  name: string;
  /** The directive being tested (e.g., "B2: Response Endings") */
  directive: string;
  /** Message sent to the agent */
  userMessage: string;
  /** Criteria the response must meet (evaluated by judge LLM) */
  criteria: string[];
  /** Optional: criteria the response must NOT meet */
  antiCriteria?: string[];
}

export interface BehaviourResult {
  test: BehaviourTest;
  agentResponse: string;
  judgement: {
    pass: boolean;
    criteriaResults: Array<{ criterion: string; pass: boolean; reason: string }>;
    overall: string;
  };
}

/**
 * Get a single response from Claude with the agent's personality.
 * Uses unstable_v2_prompt for one-shot (no session state needed).
 *
 * @param claudeMdPath - Path to CLAUDE.md (persona template or personalized instance)
 * @param userMessage - The message to send
 * @param resolveTemplate - If true, resolve {{PLACEHOLDER}} markers with test defaults
 */
export async function getAgentResponse(
  claudeMdPath: string,
  userMessage: string,
  resolveTemplate = false,
): Promise<string> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  let personality = readFileSync(claudeMdPath, "utf-8");
  if (resolveTemplate) {
    personality = resolvePersonaTemplate(personality);
  }

  // Use one-shot prompt with personality as the first message context
  const prompt = `[System] You are an AI assistant. Here is your personality and behaviour guide:\n\n${personality}\n\n---\n\nNow respond to this message from your owner. Follow your personality and behaviour rules exactly.\n\nUser: ${userMessage}`;

  const result = await sdk.unstable_v2_prompt(prompt, {
    model: "sonnet",
    pathToClaudeCodeExecutable: CLAUDE_BINARY,
    permissionMode: "plan" as const, // read-only, no tool use
  });

  if (result.type === "result" && result.subtype === "success") {
    return result.result;
  }
  throw new Error(`Agent response failed: ${JSON.stringify(result)}`);
}

/**
 * Judge an agent response against behavioural criteria.
 * Uses a separate Claude call as an impartial judge.
 */
export async function judgeResponse(
  test: BehaviourTest,
  agentResponse: string,
): Promise<BehaviourResult["judgement"]> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");

  const criteriaList = test.criteria.map((c, i) => `${i + 1}. MUST: ${c}`).join("\n");
  const antiCriteriaList = (test.antiCriteria ?? [])
    .map((c, i) => `${i + 1}. MUST NOT: ${c}`)
    .join("\n");

  const judgePrompt = `You are an impartial judge evaluating an AI assistant's response against behavioural criteria.

## Context
Directive being tested: ${test.directive}
User message: "${test.userMessage}"

## Agent Response
"${agentResponse}"

## Criteria to evaluate
${criteriaList}
${antiCriteriaList ? `\n${antiCriteriaList}` : ""}

## Instructions
For each criterion, respond with:
- PASS or FAIL
- Brief reason (1 sentence)

Then give an overall PASS/FAIL.

Respond in this exact JSON format (no markdown, no code blocks):
{"criteriaResults":[{"criterion":"...","pass":true/false,"reason":"..."}],"pass":true/false,"overall":"1 sentence summary"}`;

  const result = await sdk.unstable_v2_prompt(judgePrompt, {
    model: "sonnet",
    pathToClaudeCodeExecutable: CLAUDE_BINARY,
    permissionMode: "plan" as const,
  });

  if (result.type === "result" && result.subtype === "success") {
    try {
      // Extract JSON from response (may have surrounding text)
      const jsonMatch = result.result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {}
    // Fallback: treat as pass if we can't parse
    return {
      pass: false,
      criteriaResults: [
        { criterion: "parse", pass: false, reason: "Could not parse judge response" },
      ],
      overall: `Unparseable judge response: ${result.result.slice(0, 200)}`,
    };
  }
  throw new Error(`Judge failed: ${JSON.stringify(result)}`);
}

/**
 * Run a single behaviour test end-to-end.
 */
export async function runBehaviourTest(
  claudeMdPath: string,
  test: BehaviourTest,
  resolveTemplate = false,
): Promise<BehaviourResult> {
  console.log(`  Testing: ${test.name}`);
  console.log(`  Message: "${test.userMessage}"`);

  const agentResponse = await getAgentResponse(claudeMdPath, test.userMessage, resolveTemplate);
  console.log(
    `  Response: "${agentResponse.slice(0, 150)}${agentResponse.length > 150 ? "..." : ""}"`,
  );

  const judgement = await judgeResponse(test, agentResponse);
  console.log(`  Verdict: ${judgement.pass ? "PASS" : "FAIL"} — ${judgement.overall}`);

  return { test, agentResponse, judgement };
}

/**
 * Run all behaviour tests and return results.
 */
export async function runBehaviourSuite(
  claudeMdPath: string,
  tests: BehaviourTest[],
  resolveTemplate = false,
): Promise<BehaviourResult[]> {
  const results: BehaviourResult[] = [];
  for (const test of tests) {
    const result = await runBehaviourTest(claudeMdPath, test, resolveTemplate);
    results.push(result);
    console.log("");
  }
  return results;
}
