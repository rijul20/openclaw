import { vi } from "vitest";
import type { ChannelAdapter } from "../../src/channels/types.js";

/**
 * Create a mock channel adapter for testing.
 */
export function createMockChannel(name: string): ChannelAdapter & {
  sentMessages: string[];
  sentContacts: { to: string; text: string }[];
  fillers: string[];
} {
  const sentMessages: string[] = [];
  const sentContacts: { to: string; text: string }[] = [];
  const fillers: string[] = [];

  return {
    channelName: name,
    sentMessages,
    sentContacts,
    fillers,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(async (text: string) => {
      sentMessages.push(text);
    }),
    sendToContact: vi.fn(async (to: string, text: string) => {
      sentContacts.push({ to, text });
    }),
    sendFiller: vi.fn(async (text: string) => {
      fillers.push(text);
    }),
  };
}

/**
 * Create a mock SDK session for testing.
 */
export function createMockSession(responses: string[] = ["Hello!"]) {
  let responseIndex = 0;

  const session = {
    get sessionId() {
      return "test-session-id-" + Math.random().toString(36).slice(2, 8);
    },
    send: vi.fn(async (_message: string) => {}),
    stream: vi.fn(async function* () {
      // Yield init message first time
      yield {
        type: "system" as const,
        subtype: "init" as const,
        session_id: "test-session-id",
        tools: [],
        mcp_servers: [],
        model: "sonnet",
        permissionMode: "default",
        cwd: "/tmp",
        apiKeySource: "ANTHROPIC_API_KEY",
        claude_code_version: "1.0.0",
        slash_commands: [],
        output_style: "text",
        skills: [],
        plugins: [],
        uuid: "test-uuid",
      };
      // Then yield result
      const response = responses[responseIndex % responses.length];
      responseIndex++;
      yield {
        type: "result" as const,
        subtype: "success" as const,
        result: response,
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: false,
        num_turns: 1,
        stop_reason: "end_turn",
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: "result-uuid",
        session_id: "test-session-id",
      };
    }),
    close: vi.fn(),
    [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
  };

  return session;
}

/**
 * Create a mock config for testing.
 */
export function createMockConfig(overrides?: Record<string, unknown>) {
  return {
    users: {
      alice: {
        workspace: "/tmp/rclaw-test-alice",
        model: "sonnet",
        channels: {
          telegram: { botToken: "test-token" },
          whatsapp: {
            authDir: "/tmp/rclaw-test-wa-auth",
            ownerNumber: "+919916978177",
          },
        },
      },
    },
    qrPort: 3847,
    ...overrides,
  };
}

/**
 * Wait for async batching to complete.
 */
export async function waitForBatch(ms = 4000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
