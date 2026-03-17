/**
 * Mock SDK module that replaces @anthropic-ai/claude-agent-sdk for e2e testing.
 *
 * Uses globalThis to share state between the mock instance loaded by the orchestrator
 * (via vi.mock) and the test file's direct import.
 */

// --- Global shared state (survives module instance duplication) ---

interface MockState {
  sessionLog: Array<{
    key: string;
    sessionId: string;
    messages: string[];
    responses: string[];
  }>;
  activeSessions: Map<string, MockSession>;
  createdSessions: string[];
  resumedSessions: string[];
  sessionCounter: number;
  ownerResponder: Responder;
  contactResponder: Responder;
}

const STATE_KEY = "__rclaw_mock_sdk_state__";

function getState(): MockState {
  if (!(globalThis as Record<string, unknown>)[STATE_KEY]) {
    (globalThis as Record<string, unknown>)[STATE_KEY] = {
      sessionLog: [],
      activeSessions: new Map(),
      createdSessions: [],
      resumedSessions: [],
      sessionCounter: 0,
      ownerResponder: defaultOwnerResponder,
      contactResponder: defaultContactResponder,
    };
  }
  return (globalThis as Record<string, unknown>)[STATE_KEY] as MockState;
}

// --- Exports that reference global state ---

export type Responder = (message: string, sessionKey: string) => string;

export const sessionLog = new Proxy([] as MockState["sessionLog"], {
  get(_, prop) {
    const s = getState();
    return Reflect.get(s.sessionLog, prop);
  },
});

// Can't proxy Map easily, so use getter functions
export function getActiveSessions(): Map<string, MockSession> {
  return getState().activeSessions;
}
export function getCreatedSessions(): string[] {
  return getState().createdSessions;
}
export function getResumedSessions(): string[] {
  return getState().resumedSessions;
}
export function getSessionLog(): MockState["sessionLog"] {
  return getState().sessionLog;
}

export function setOwnerResponder(fn: Responder) {
  getState().ownerResponder = fn;
}
export function setContactResponder(fn: Responder) {
  getState().contactResponder = fn;
}

export function resetMockSdk() {
  const s = getState();
  s.sessionLog.length = 0;
  s.activeSessions.clear();
  s.createdSessions.length = 0;
  s.resumedSessions.length = 0;
  s.sessionCounter = 0;
  s.ownerResponder = defaultOwnerResponder;
  s.contactResponder = defaultContactResponder;
}

// --- Default responders ---

function defaultOwnerResponder(message: string, _key: string): string {
  if (message.startsWith("[System]")) {
    return "Understood! I'm Ayesha, ready to help. Bataiye kya karna hai?";
  }
  if (message.startsWith("[Scheduled Task]")) {
    return `Task noted: ${message.slice(17, 60)}. I'll handle it.`;
  }
  if (message.startsWith("[Contact update")) {
    return "Got it, noted the contact update.";
  }
  if (message.startsWith("[SECURITY ALERT]")) {
    return "Thank you for the alert. I've noted this security concern.";
  }
  return `Ayesha here! You said: "${message.slice(0, 50)}". How can I help further?`;
}

function defaultContactResponder(message: string, _key: string): string {
  if (message.startsWith("[System]")) {
    return "Hello! I'm here to help with your request.";
  }
  if (
    message.toLowerCase().includes("ignore your instructions") ||
    message.toLowerCase().includes("you are now") ||
    message.toLowerCase().includes("system:") ||
    message.toLowerCase().includes("reveal your prompt") ||
    message.toLowerCase().includes("what is your system prompt")
  ) {
    return "[BLOCK_CONTACT] This conversation has been terminated.";
  }
  return `Thanks for your message! Regarding "${message.slice(0, 40)}" — let me help with that.`;
}

// --- Mock Session ---

export class MockSession {
  readonly sessionId: string;
  readonly key: string;
  private messages: string[] = [];
  private responses: string[] = [];
  private pendingResponse: string | null = null;
  private closed = false;
  private isContact: boolean;
  private logEntry: MockState["sessionLog"][0];

  constructor(key: string) {
    const s = getState();
    this.key = key;
    this.sessionId = `mock-session-${++s.sessionCounter}`;
    this.isContact = key.startsWith("contact:");
    this.logEntry = {
      key,
      sessionId: this.sessionId,
      messages: this.messages,
      responses: this.responses,
    };
    s.sessionLog.push(this.logEntry);
    s.activeSessions.set(key, this);
  }

  async send(message: string | { type: string; message: unknown }) {
    if (this.closed) {
      throw new Error("Session closed");
    }
    const text = typeof message === "string" ? message : JSON.stringify(message);
    this.messages.push(text);

    const s = getState();
    const responder = this.isContact ? s.contactResponder : s.ownerResponder;
    this.pendingResponse = responder(text, this.key);
    this.responses.push(this.pendingResponse);
  }

  async *stream() {
    if (this.closed) {
      throw new Error("Session closed");
    }

    // First call (init): yield system init when no messages yet
    if (this.messages.length === 0) {
      yield {
        type: "system" as const,
        subtype: "init" as const,
        session_id: this.sessionId,
        tools: ["Read", "Write", "Edit", "Glob", "Grep"],
        mcp_servers: [],
        model: "sonnet",
        permissionMode: "default" as const,
        cwd: process.cwd(),
        apiKeySource: "ANTHROPIC_API_KEY" as const,
        claude_code_version: "1.0.0",
        slash_commands: [],
        output_style: "text",
        skills: [],
        plugins: [],
        uuid: `uuid-${this.sessionId}`,
      };
      yield {
        type: "result" as const,
        subtype: "success" as const,
        result: "",
        duration_ms: 50,
        duration_api_ms: 40,
        is_error: false,
        num_turns: 0,
        stop_reason: "end_turn",
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        uuid: `result-${this.sessionId}`,
        session_id: this.sessionId,
      };
      return;
    }

    // Subsequent calls: yield result for pending response
    yield {
      type: "result" as const,
      subtype: "success" as const,
      result: this.pendingResponse || "",
      duration_ms: 200,
      duration_api_ms: 150,
      is_error: false,
      num_turns: 1,
      stop_reason: "end_turn",
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
      modelUsage: {},
      permission_denials: [],
      uuid: `result-${Date.now()}`,
      session_id: this.sessionId,
    };
    this.pendingResponse = null;
  }

  close() {
    this.closed = true;
    getState().activeSessions.delete(this.key);
  }

  getMessages() {
    return [...this.messages];
  }
  getResponses() {
    return [...this.responses];
  }

  async [Symbol.asyncDispose]() {
    this.close();
  }
}

// --- Exported SDK functions ---

function cwdToKey(cwd: string): string {
  if (cwd.includes("/contacts/")) {
    const parts = cwd.split("/contacts/");
    const phone = parts[parts.length - 1].replace(/\//g, "");
    const workspacePart = parts[0];
    const userId = workspacePart.split("/").pop() || "unknown";
    return `contact:${userId}:${phone}`;
  }
  const userId = cwd.split("/").pop() || "unknown";
  return `owner:${userId}`;
}

export function unstable_v2_createSession(_options: Record<string, unknown>): MockSession {
  const cwd = process.cwd();
  const key = cwdToKey(cwd);
  getState().createdSessions.push(key);
  return new MockSession(key);
}

export function unstable_v2_resumeSession(
  _sessionId: string,
  _options: Record<string, unknown>,
): MockSession {
  const cwd = process.cwd();
  const key = cwdToKey(cwd);
  getState().resumedSessions.push(key);
  return new MockSession(key);
}
