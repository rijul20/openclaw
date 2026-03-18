/**
 * UAT (User Acceptance Test) framework — Layer 3.
 *
 * Runs the REAL orchestrator with REAL Claude (Sonnet), sends messages
 * through the actual pipeline, captures responses, and judges them.
 *
 * Unlike behaviour tests (one-shot prompts), UAT tests use multi-turn
 * sessions and test the full orchestrator pipeline including:
 * - Session creation/resume with real Claude
 * - Owner vs contact routing
 * - Contact isolation (separate sessions)
 * - Context leak prevention
 * - Personality injection via session.send()
 * - Outbox processing
 * - Rate limiting
 *
 * Run: UAT=1 npx vitest run tests/uat/
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../../src/config.js";
import { Orchestrator } from "../../src/orchestrator.js";
import { setStorePath, resetStorePath } from "../../src/session-store.js";

const ASSISTANT_PERSONA = new URL("../../personas/assistant/CLAUDE.md", import.meta.url).pathname;

// --- UAT Test Types ---

export interface UATScenario {
  name: string;
  /** Which use case this tests (e.g., "UC1", "UC5+UC6") */
  useCase: string;
  /** Description of what's being tested */
  description: string;
  /** The test function — receives a running orchestrator + helpers */
  run: (ctx: UATContext) => Promise<UATResult>;
}

export interface UATContext {
  orchestrator: Orchestrator;
  workspace: string;
  /** Send a message as the owner, return the response */
  ownerSays: (text: string) => Promise<string>;
  /** Send a message as a contact, return the response */
  contactSays: (phone: string, text: string) => Promise<string>;
  /** Judge a response against criteria */
  judge: (
    response: string,
    criteria: string[],
    antiCriteria?: string[],
    context?: string,
  ) => Promise<{ pass: boolean; overall: string; details: string[] }>;
}

export interface UATResult {
  pass: boolean;
  steps: Array<{ step: string; pass: boolean; detail: string }>;
}

// --- Orchestrator Setup ---

/**
 * Create a real orchestrator with a test workspace and the assistant persona.
 * Uses real Claude (Sonnet) — not mocked.
 */
export async function createUATOrchestrator(): Promise<{
  orchestrator: Orchestrator;
  workspace: string;
  cleanup: () => void;
}> {
  const testRoot = `/tmp/rclaw-uat-${process.pid}-${Date.now()}`;
  const workspace = join(testRoot, "agents", "uat-user");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(workspace, "memory"), { recursive: true });
  mkdirSync(join(workspace, "outbox"), { recursive: true });

  // Write resolved persona template as the agent's CLAUDE.md
  let template = readFileSync(ASSISTANT_PERSONA, "utf-8");
  template = template
    .replace(/\{\{AGENT_NAME\}\}/g, "Alex")
    .replace(/\{\{AGENT_BACKGROUND\}\}/g, "A warm, capable AI assistant for testing")
    .replace(/\{\{AGENT_LANGUAGES\}\}/g, "English")
    .replace(/\{\{AGENT_TONE\}\}/g, "Warm and friendly")
    .replace(/\{\{AGENT_HUMOR\}\}/g, "Light humor")
    .replace(/\{\{AGENT_FORMALITY\}\}/g, "Casual but respectful")
    .replace(/\{\{AGENT_EMOJI\}\}/g, "")
    .replace(/\{\{GOLDEN_RULE[^}]*\}\}/g, "Be helpful, be real, be concise.");
  writeFileSync(join(workspace, "CLAUDE.md"), template);

  // Isolated session store
  const storePath = join(testRoot, "sessions.json");
  setStorePath(storePath);

  const config: Config = {
    users: {
      "uat-user": {
        workspace,
        model: "sonnet",
        channels: {
          whatsapp: {
            authDir: join(testRoot, "wa-auth"),
            ownerNumber: "+911111111111",
          },
        },
      },
    },
    qrPort: 0,
  };

  const orchestrator = new Orchestrator(config);

  // Register a mock WhatsApp channel so sendToContact works
  orchestrator.registerChannel("uat-user", "whatsapp", {
    channelName: "whatsapp",
    start: async () => {},
    stop: async () => {},
    sendMessage: async () => {},
    sendToContact: async () => {},
    sendFiller: async () => {},
  });

  await orchestrator.initOwnerSession("uat-user");

  const cleanup = () => {
    orchestrator.shutdown().catch(() => {});
    resetStorePath();
    try {
      rmSync(testRoot, { recursive: true, force: true });
    } catch {}
  };

  return { orchestrator, workspace, cleanup };
}

/**
 * Create UAT context with helper functions for sending messages and judging.
 */
export function createUATContext(orchestrator: Orchestrator, workspace: string): UATContext {
  const ownerSays = (text: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Owner response timeout (60s)")), 60000);
      const handler = orchestrator.createOwnerMessageHandler("uat-user");
      handler(text, async (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });

  const contactSays = (phone: string, text: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Contact response timeout (60s)")), 60000);
      const router = orchestrator.createWhatsAppRouter("uat-user");
      router(`${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`, text, async (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });

  const judge = async (
    response: string,
    criteria: string[],
    antiCriteria?: string[],
    context?: string,
  ) => {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const CLAUDE_BINARY = "/Users/rijul/.local/share/claude/versions/2.1.77";

    const criteriaList = criteria.map((c, i) => `${i + 1}. MUST: ${c}`).join("\n");
    const antiList = (antiCriteria ?? []).map((c, i) => `${i + 1}. MUST NOT: ${c}`).join("\n");

    const prompt = `You are an impartial judge evaluating an AI assistant's response.

${context ? `## Context\n${context}\n` : ""}
## Agent Response
"${response}"

## Criteria
${criteriaList}
${antiList ? `\n${antiList}` : ""}

Respond in JSON (no markdown): {"pass":true/false,"overall":"1 sentence","details":["criterion 1: PASS/FAIL reason","criterion 2: ..."]}`;

    const result = await sdk.unstable_v2_prompt(prompt, {
      model: "sonnet",
      pathToClaudeCodeExecutable: CLAUDE_BINARY,
      permissionMode: "plan" as const,
    });

    if (result.type === "result" && result.subtype === "success") {
      try {
        const match = result.result.match(/\{[\s\S]*\}/);
        if (match) {
          return JSON.parse(match[0]);
        }
      } catch {}
    }
    return {
      pass: false,
      overall: "Judge parse failure",
      details: ["Could not parse judge output"],
    };
  };

  return { orchestrator, workspace, ownerSays, contactSays, judge };
}

/**
 * Run all UAT scenarios sequentially.
 */
export async function runUATSuite(scenarios: UATScenario[]): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  rclaw UAT — ${scenarios.length} scenarios (real Claude Sonnet)`);
  console.log(`${"=".repeat(60)}\n`);

  const { orchestrator, workspace, cleanup } = await createUATOrchestrator();
  console.log(`  Orchestrator ready. Workspace: ${workspace}\n`);

  const ctx = createUATContext(orchestrator, workspace);
  const results: Array<{ scenario: UATScenario; result: UATResult }> = [];

  for (const scenario of scenarios) {
    console.log(`--- ${scenario.useCase}: ${scenario.name} ---`);
    console.log(`    ${scenario.description}`);
    try {
      const result = await scenario.run(ctx);
      results.push({ scenario, result });
      const icon = result.pass ? "PASS" : "FAIL";
      console.log(`    ${icon}`);
      for (const step of result.steps) {
        const stepIcon = step.pass ? "  ok" : "  FAIL";
        console.log(`    ${stepIcon}: ${step.step} — ${step.detail}`);
      }
    } catch (err) {
      console.log(`    ERROR: ${String(err)}`);
      results.push({
        scenario,
        result: { pass: false, steps: [{ step: "execution", pass: false, detail: String(err) }] },
      });
    }
    console.log("");
  }

  // Summary
  const passed = results.filter((r) => r.result.pass).length;
  console.log("=".repeat(60));
  console.log(`  UAT Results: ${passed}/${results.length} passed`);
  console.log(`${"=".repeat(60)}\n`);

  for (const r of results) {
    const icon = r.result.pass ? "PASS" : "FAIL";
    console.log(`  ${icon}: [${r.scenario.useCase}] ${r.scenario.name}`);
  }

  cleanup();
  console.log("\n  Cleanup done.\n");
}
