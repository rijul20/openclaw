import { describe, expect, it, vi } from "vitest";
import { registerSingleProviderPlugin } from "../../src/test-utils/plugin-registration.js";
import claudeCodePlugin from "./index.js";

describe("claude-code provider plugin", () => {
  it("registers a provider with id 'claude-code'", () => {
    const provider = registerSingleProviderPlugin(claudeCodePlugin);
    expect(provider.id).toBe("claude-code");
    expect(provider.label).toBe("Claude Code");
  });

  it("has a single 'local' auth method", () => {
    const provider = registerSingleProviderPlugin(claudeCodePlugin);
    expect(provider.auth).toHaveLength(1);
    expect(provider.auth[0]!.id).toBe("local");
    expect(provider.auth[0]!.kind).toBe("custom");
  });

  it("catalog returns three models with zero cost", async () => {
    const provider = registerSingleProviderPlugin(claudeCodePlugin);
    const result = await provider.catalog!.run({
      config: {} as never,
      env: process.env,
      resolveProviderApiKey: () => ({ apiKey: undefined }),
    });

    expect(result).toBeTruthy();
    const prov = (
      result as { provider: { models: Array<{ id: string; cost: unknown; api: string }> } }
    ).provider;
    expect(prov.models).toHaveLength(3);

    const ids = prov.models.map((m) => m.id);
    expect(ids).toEqual(["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"]);

    // All costs should be zero (billed through Claude Code subscription)
    for (const model of prov.models) {
      expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    }

    // All models use anthropic-messages API
    for (const model of prov.models) {
      expect(model.api).toBe("anthropic-messages");
    }
  });

  it("catalog always returns models regardless of API key", async () => {
    const provider = registerSingleProviderPlugin(claudeCodePlugin);

    // No API key — should still return models
    const result = await provider.catalog!.run({
      config: {} as never,
      env: {},
      resolveProviderApiKey: () => ({ apiKey: undefined }),
    });
    expect(result).toBeTruthy();
  });

  it("wrapStreamFn returns a new StreamFn (replaces, not wraps)", () => {
    const provider = registerSingleProviderPlugin(claudeCodePlugin);
    expect(provider.wrapStreamFn).toBeDefined();

    const streamFn = provider.wrapStreamFn!({
      config: {} as never,
      provider: "claude-code",
      modelId: "sonnet",
      streamFn: undefined,
    });

    expect(streamFn).toBeDefined();
    expect(typeof streamFn).toBe("function");
  });

  it("wrapStreamFn-produced StreamFn surfaces SDK errors as stream errors", async () => {
    // Mock the SDK to throw immediately
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: () => {
        throw new Error("Claude Code not authenticated");
      },
    }));

    const provider = registerSingleProviderPlugin(claudeCodePlugin);
    const streamFn = provider.wrapStreamFn!({
      config: {} as never,
      provider: "claude-code",
      modelId: "sonnet",
      streamFn: undefined,
    })!;

    const model = {
      id: "sonnet",
      name: "sonnet",
      api: "anthropic-messages",
      provider: "claude-code",
      baseUrl: "local://claude-code",
      reasoning: true,
      input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 16_384,
    };

    const context = {
      systemPrompt: "You are helpful.",
      messages: [{ role: "user" as const, content: "Hello", timestamp: Date.now() }],
      tools: [],
    };

    const stream = await streamFn(model, context);
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    // Should have an error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.type).toBe("error");
  });

  it("wrapStreamFn-produced StreamFn converts SDK streaming events", async () => {
    // Mock the SDK to yield a minimal stream_event + result sequence
    const mockMessages = [
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        parent_tool_use_id: null,
        uuid: "test-uuid-1",
        session_id: "test-session",
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello world" },
        },
        parent_tool_use_id: null,
        uuid: "test-uuid-2",
        session_id: "test-session",
      },
      {
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
        parent_tool_use_id: null,
        uuid: "test-uuid-3",
        session_id: "test-session",
      },
      {
        type: "stream_event",
        event: {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 5 },
        },
        parent_tool_use_id: null,
        uuid: "test-uuid-4",
        session_id: "test-session",
      },
      {
        type: "result",
        subtype: "success",
        result: "Hello world",
        is_error: false,
        duration_ms: 100,
        duration_api_ms: 80,
        num_turns: 1,
        session_id: "test-session",
      },
    ];

    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: () => {
        // Return an async generator that yields our mock messages
        return (async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        })();
      },
    }));

    // Re-import to pick up the mock
    vi.resetModules();
    const { default: freshPlugin } = await import("./index.js");
    const provider = registerSingleProviderPlugin(freshPlugin);

    const streamFn = provider.wrapStreamFn!({
      config: {} as never,
      provider: "claude-code",
      modelId: "sonnet",
      streamFn: undefined,
    })!;

    const model = {
      id: "sonnet",
      name: "sonnet",
      api: "anthropic-messages",
      provider: "claude-code",
      baseUrl: "local://claude-code",
      reasoning: true,
      input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 16_384,
    };

    const context = {
      systemPrompt: "You are helpful.",
      messages: [{ role: "user" as const, content: "Hello", timestamp: Date.now() }],
      tools: [],
    };

    const stream = await streamFn(model, context);
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    // Should have: start, text_start, text_delta, text_end, done
    const types = events.map((e) => e.type);
    expect(types).toContain("start");
    expect(types).toContain("text_start");
    expect(types).toContain("text_delta");
    expect(types).toContain("text_end");
    expect(types).toContain("done");

    // The done event should have the completed message with text
    const doneEvent = events.find((e) => e.type === "done")!;
    expect(doneEvent.type).toBe("done");
    if (doneEvent.type === "done") {
      expect(doneEvent.message.content).toHaveLength(1);
      expect(doneEvent.message.content[0]!.type).toBe("text");
      expect((doneEvent.message.content[0] as { text: string }).text).toBe("Hello world");
    }
  });
});
