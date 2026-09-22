import { describe, expect, it, vi, beforeEach } from "vitest";
import { upsertHeartbeat } from "./log";

// Session time silently stopped accumulating for every non-admin because the
// old implementation read the row before writing it, and analytics_sessions
// deliberately has no select-own policy (0013). These tests pin the two
// properties that fix depends on: it never reads, and it never tells the
// database who the user is.

function fakeClient() {
  const calls: { fn: string; args: unknown }[] = [];
  return {
    calls,
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve({ error: null });
    },
    from: () => {
      throw new Error("heartbeat must not touch the table directly");
    },
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("upsertHeartbeat", () => {
  it("increments through a single RPC and never reads the table", async () => {
    const c = fakeClient();

    // `from` throws, so this passing at all is the assertion that matters:
    // any reintroduced SELECT/INSERT would fail the test.
    await upsertHeartbeat(c as never, "user-1", "session-abc");

    expect(c.calls).toEqual([{ fn: "record_heartbeat", args: { p_session_id: "session-abc" } }]);
  });

  it("never sends a user id — the database takes the owner from auth.uid()", async () => {
    const c = fakeClient();

    await upsertHeartbeat(c as never, "user-1", "session-abc");

    // Passing the id would let a caller credit a beat to someone else.
    expect(JSON.stringify(c.calls[0].args)).not.toContain("user-1");
  });

  it("stays best-effort when the RPC fails, but says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = {
      rpc: () => Promise.resolve({ error: { message: "not authenticated" } }),
      from: () => { throw new Error("must not read"); },
    };

    // A lost beat must never fail the request that carried it...
    await expect(upsertHeartbeat(c as never, "u", "s")).resolves.toBeUndefined();
    // ...but silence is what hid the original bug, so it is logged.
    expect(warn).toHaveBeenCalledWith("heartbeat failed:", "not authenticated");
  });

  it("swallows a thrown transport error too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = {
      rpc: () => Promise.reject(new Error("network down")),
      from: () => { throw new Error("must not read"); },
    };

    await expect(upsertHeartbeat(c as never, "u", "s")).resolves.toBeUndefined();
  });
});
