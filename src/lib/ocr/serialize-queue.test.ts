import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serialize-queue";

// A task that resolves after a tick, recording when it started and finished
// against a shared log -- lets a test assert ordering, not just outcomes.
function tracked<T>(log: string[], name: string, result: () => T | Promise<T>, delayMs = 0) {
  return async () => {
    log.push(`${name}:start`);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const value = await result();
    log.push(`${name}:end`);
    return value;
  };
}

describe("createSerialQueue", () => {
  it("runs tasks one at a time, never overlapping", async () => {
    const run = createSerialQueue();
    const log: string[] = [];

    const a = run(tracked(log, "a", () => "A", 20));
    const b = run(tracked(log, "b", () => "B", 5));
    const c = run(tracked(log, "c", () => "C", 0));

    await Promise.all([a, b, c]);

    // Each task's own start/end are adjacent -- b never starts before a
    // ends, even though b's own delay is shorter than a's. That's the
    // actual property this fixes: two "requests" (a, b) landing on the
    // same worker at the same moment used to both be in flight together.
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("resolves each caller with its own task's result, in submission order", async () => {
    const run = createSerialQueue();
    const results = await Promise.all([1, 2, 3].map((n) => run(async () => n * 10)));
    expect(results).toEqual([10, 20, 30]);
  });

  // The property this whole fix exists for: a crash/rejection in the OCR
  // worker used to reject every *other* pending request too (failWorker
  // clears its whole pending map), not just the one that actually caused
  // it. Serializing on its own doesn't prevent a crash, but it does confirm
  // the queue keeps moving afterward instead of wedging -- so anything
  // queued behind a failure gets to run, rather than inheriting that
  // failure or hanging forever.
  it("a rejected task doesn't take down or block the tasks queued behind it", async () => {
    const run = createSerialQueue();
    const log: string[] = [];

    const a = run(tracked(log, "a", () => { throw new Error("worker crashed"); }));
    const b = run(tracked(log, "b", () => "B"));

    await expect(a).rejects.toThrow("worker crashed");
    await expect(b).resolves.toBe("B");
    expect(log).toEqual(["a:start", "b:start", "b:end"]);
  });

  it("a later task started only after an earlier rejection had fully settled", async () => {
    const run = createSerialQueue();
    const order: string[] = [];

    const a = run(async () => {
      order.push("a-runs");
      throw new Error("boom");
    });
    a.catch(() => {}); // don't let the unhandled rejection fail the test run

    const b = run(async () => {
      order.push("b-runs");
      return "ok";
    });

    await expect(b).resolves.toBe("ok");
    expect(order).toEqual(["a-runs", "b-runs"]);
  });

  it("independent queues don't serialize against each other", async () => {
    const runA = createSerialQueue();
    const runB = createSerialQueue();
    const log: string[] = [];

    await Promise.all([
      runA(tracked(log, "a", () => undefined, 20)),
      runB(tracked(log, "b", () => undefined, 0)),
    ]);

    // b, on its own queue, finishes before a's 20ms delay is up -- proof
    // this doesn't accidentally become a single global lock.
    expect(log.indexOf("b:end")).toBeLessThan(log.indexOf("a:end"));
  });
});
