import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { startOutboxWatcher } from "../src/outbox-watcher.js";

// Each test gets a unique directory
function makeOutbox() {
  const dir = `/tmp/rclaw-outbox-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

const cleanups: (() => void)[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const fn of cleanups) {
    fn();
  }
  cleanups.length = 0;
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  dirs.length = 0;
});

describe("outbox watcher", () => {
  it("processes send payloads", async () => {
    const dir = makeOutbox();
    dirs.push(dir);
    const sends: Array<{ to: string; text: string }> = [];

    const cleanup = startOutboxWatcher(
      dir,
      async (payload) => sends.push({ to: payload.to, text: payload.text }),
      async () => {},
    );
    cleanups.push(cleanup);

    // Let watcher initialize
    await new Promise((r) => setTimeout(r, 200));

    const filename = join(dir, `${Date.now()}.json`);
    writeFileSync(
      filename,
      JSON.stringify({
        type: "send",
        to: "+919876543210",
        text: "Hello there",
        task: "Check status",
      }),
    );

    // Wait for processing (fs.watch + poll fallback)
    await new Promise((r) => setTimeout(r, 1500));

    expect(sends).toHaveLength(1);
    expect(sends[0].to).toBe("+919876543210");
    expect(existsSync(filename)).toBe(false);
  });

  it("processes reply payloads", async () => {
    const dir = makeOutbox();
    dirs.push(dir);
    const replies: Array<{ phone: string; text: string }> = [];

    const cleanup = startOutboxWatcher(
      dir,
      async () => {},
      async (payload) => replies.push({ phone: payload.phone, text: payload.text }),
    );
    cleanups.push(cleanup);

    await new Promise((r) => setTimeout(r, 200));

    writeFileSync(
      join(dir, "reply.json"),
      JSON.stringify({ type: "reply", phone: "919876543210", text: "Approved" }),
    );

    await new Promise((r) => setTimeout(r, 1500));

    expect(replies).toHaveLength(1);
    expect(replies[0].phone).toBe("919876543210");
  });

  it("ignores non-json files", async () => {
    const dir = makeOutbox();
    dirs.push(dir);
    let called = false;

    const cleanup = startOutboxWatcher(
      dir,
      async () => {
        called = true;
      },
      async () => {
        called = true;
      },
    );
    cleanups.push(cleanup);

    await new Promise((r) => setTimeout(r, 200));

    writeFileSync(join(dir, "readme.txt"), "not json");
    await new Promise((r) => setTimeout(r, 1000));

    expect(called).toBe(false);
  });

  it("moves malformed files to .failed", async () => {
    const dir = makeOutbox();
    dirs.push(dir);

    const cleanup = startOutboxWatcher(
      dir,
      async () => {
        throw new Error("handler error");
      },
      async () => {},
    );
    cleanups.push(cleanup);

    await new Promise((r) => setTimeout(r, 200));

    const filepath = join(dir, "bad.json");
    writeFileSync(filepath, JSON.stringify({ type: "send", to: "123", text: "hi" }));

    await new Promise((r) => setTimeout(r, 1500));

    expect(existsSync(filepath)).toBe(false);
    expect(existsSync(filepath + ".failed")).toBe(true);
  });
});
