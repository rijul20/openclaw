import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { BatchTimer } from "../src/batch-timer.js";
import { normalizePhone, chunkText } from "../src/orchestrator.js";
import { createSandboxWrapper } from "../src/sandbox.js";
import {
  loadSessions,
  saveSession,
  removeSession,
  setStorePath,
  resetStorePath,
} from "../src/session-store.js";

// UC1: Basic utility functions
describe("normalizePhone", () => {
  it("strips non-digits", () => {
    expect(normalizePhone("+91-9916-978177")).toBe("919916978177");
    expect(normalizePhone("919916978177@s.whatsapp.net")).toBe("919916978177");
  });
});

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    expect(chunkText("hello", 4000)).toEqual(["hello"]);
  });

  it("splits long text at line breaks", () => {
    const text = "line1\n".repeat(1000);
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });
});

// UC26: Session store persistence
describe("session-store", () => {
  const testStorePath = `/tmp/rclaw-session-test-${process.pid}.json`;

  it("saves and loads sessions", () => {
    setStorePath(testStorePath);
    try {
      saveSession("test:key", "session-123");
      const sessions = loadSessions();
      expect(sessions["test:key"]).toBe("session-123");

      removeSession("test:key");
      const after = loadSessions();
      expect(after["test:key"]).toBeUndefined();
    } finally {
      resetStorePath();
      try {
        require("node:fs").unlinkSync(testStorePath);
      } catch {}
    }
  });
});

// UC27: Sandbox wrapper generation
describe("sandbox", () => {
  it("creates a wrapper script", () => {
    const wrapper = createSandboxWrapper("/tmp/test-workspace", "/usr/bin/echo");
    expect(existsSync(wrapper)).toBe(true);
    const content = readFileSync(wrapper, "utf-8");
    expect(content).toContain("#!/bin/bash");
    if (process.platform === "darwin") {
      expect(content).toContain("sandbox-exec");
    }
  });
});

// UC28: Batch timer
describe("BatchTimer", () => {
  it("fires after silence window", async () => {
    let fired: string[] = [];
    const timer = new BatchTimer(100, (msgs) => {
      fired = msgs;
    });

    timer.add("msg1");
    timer.add("msg2");
    timer.add("msg3");

    // Not fired yet
    expect(fired).toEqual([]);

    // Wait for silence window
    await new Promise((r) => setTimeout(r, 200));
    expect(fired).toEqual(["msg1", "msg2", "msg3"]);
  });

  it("resets timer on new messages", async () => {
    let fired: string[] = [];
    const timer = new BatchTimer(150, (msgs) => {
      fired = msgs;
    });

    timer.add("a");
    await new Promise((r) => setTimeout(r, 100));
    timer.add("b"); // resets timer
    await new Promise((r) => setTimeout(r, 100));
    expect(fired).toEqual([]); // still waiting
    await new Promise((r) => setTimeout(r, 100));
    expect(fired).toEqual(["a", "b"]);
  });

  it("flush fires immediately", () => {
    let fired: string[] = [];
    const timer = new BatchTimer(5000, (msgs) => {
      fired = msgs;
    });

    timer.add("x");
    timer.add("y");
    timer.flush();
    expect(fired).toEqual(["x", "y"]);
  });
});
