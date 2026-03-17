import { describe, it, expect } from "vitest";
import { BatchTimer } from "../src/batch-timer.js";

// UC2: Multiple messages batched into one
describe("message batching", () => {
  it("UC2: batches rapid messages into single callback", async () => {
    const batches: string[][] = [];
    const timer = new BatchTimer(200, (msgs) => {
      batches.push([...msgs]);
    });

    // Simulate 4 rapid messages
    timer.add("Hey");
    timer.add("Can you check");
    timer.add("the flight status");
    timer.add("for tomorrow?");

    await new Promise((r) => setTimeout(r, 400));

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(["Hey", "Can you check", "the flight status", "for tomorrow?"]);
  });

  // UC10: Single message not delayed excessively
  it("UC10: single message fires after delay", async () => {
    let firedAt = 0;
    const startedAt = Date.now();
    const timer = new BatchTimer(200, () => {
      firedAt = Date.now();
    });

    timer.add("single message");
    await new Promise((r) => setTimeout(r, 400));

    const delay = firedAt - startedAt;
    expect(delay).toBeGreaterThanOrEqual(180); // ~200ms
    expect(delay).toBeLessThan(500);
  });

  // UC11: Timer resets on each new message
  it("UC11: adding message resets the silence window", async () => {
    let fired = false;
    const timer = new BatchTimer(300, () => {
      fired = true;
    });

    timer.add("msg1");
    await new Promise((r) => setTimeout(r, 200));
    expect(fired).toBe(false);

    timer.add("msg2"); // resets
    await new Promise((r) => setTimeout(r, 200));
    expect(fired).toBe(false);

    await new Promise((r) => setTimeout(r, 200));
    expect(fired).toBe(true);
  });

  // UC12: Flush forces immediate fire
  it("UC12: flush sends accumulated messages immediately", () => {
    let result: string[] = [];
    const timer = new BatchTimer(60000, (msgs) => {
      result = msgs;
    });

    timer.add("a");
    timer.add("b");
    timer.flush();

    expect(result).toEqual(["a", "b"]);
  });

  // UC13: Empty flush is no-op
  it("UC13: flush with no messages is a no-op", () => {
    let callCount = 0;
    const timer = new BatchTimer(100, () => {
      callCount++;
    });

    timer.flush();
    expect(callCount).toBe(0);
  });
});
