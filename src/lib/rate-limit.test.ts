import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The limiter now does a Postgres RPC (migration 0042) through a service-role
// client it builds internally. We mock @supabase/supabase-js so `.rpc()` is a
// spy we script per test -- no database, and the same round-trip shape the real
// code sees. The client is memoized in the module, so the spy is created once
// and its behaviour is reset each test.
const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

import { clientIpKey, enforceRateLimit, rateLimit } from "./rate-limit";

const allow = { data: { allowed: true, retry_after_seconds: 0 }, error: null };
const block = (retry: number) => ({ data: { allowed: false, retry_after_seconds: retry }, error: null });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  rpc.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rateLimit", () => {
  it("allows when the counter says it's under the limit", async () => {
    rpc.mockResolvedValue(allow);
    const r = await rateLimit("k", 3, 60_000);
    expect(r.ok).toBe(true);
    // Window is passed to the RPC in whole seconds.
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_bucket: "k",
      p_max: 3,
      p_window_seconds: 60,
    });
  });

  it("blocks and reports retry-after when the counter says it's over", async () => {
    rpc.mockResolvedValue(block(12));
    const r = await rateLimit("k", 3, 60_000);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSeconds).toBe(12);
  });

  it("rounds a sub-second window up to at least one second", async () => {
    rpc.mockResolvedValue(allow);
    await rateLimit("k", 1, 1500);
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_bucket: "k",
      p_max: 1,
      p_window_seconds: 2,
    });
  });

  // Fail open is the load-bearing property: a limiter that 429s everyone when
  // the database blips is worse than no limiter at all.
  it("fails open when the RPC returns an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    expect((await rateLimit("k", 1, 60_000)).ok).toBe(true);
  });

  it("fails open when the RPC throws", async () => {
    rpc.mockRejectedValue(new Error("network down"));
    expect((await rateLimit("k", 1, 60_000)).ok).toBe(true);
  });

  it("fails open on an unexpected response shape rather than blocking", async () => {
    rpc.mockResolvedValue({ data: "not an object", error: null });
    expect((await rateLimit("k", 1, 60_000)).ok).toBe(true);
  });
});

describe("enforceRateLimit", () => {
  it("returns null while under the limit, so the route proceeds", async () => {
    rpc.mockResolvedValue(allow);
    expect(await enforceRateLimit("k", 2, 60_000)).toBeNull();
  });

  it("answers with a 429 carrying Retry-After once over", async () => {
    rpc.mockResolvedValue(block(7));
    const response = await enforceRateLimit("k", 1, 60_000);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    expect(response!.headers.get("Retry-After")).toBe("7");

    const body = (await response!.json()) as { error: string; retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBe(7);
  });

  // The whole point of the helper: a 429 a person can read.
  it("carries a human-readable message, default or supplied", async () => {
    rpc.mockResolvedValue(block(5));

    const dflt = (await (await enforceRateLimit("k", 1, 60_000))!.json()) as { error: string };
    expect(dflt.error).toMatch(/wait a moment and try again/i);

    const custom = (await (await enforceRateLimit(
      "k",
      1,
      60_000,
      "Too many imports in a row. Give it a minute.",
    ))!.json()) as { error: string };
    expect(custom.error).toBe("Too many imports in a row. Give it a minute.");
  });
});

describe("clientIpKey", () => {
  it("prefers the header Netlify's edge sets from the real peer", () => {
    const headers = new Headers({
      "x-nf-client-connection-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1",
    });
    expect(clientIpKey(headers)).toBe("203.0.113.7");
  });

  it("takes the left-most entry of a forwarded chain", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1, 10.0.0.2" });
    expect(clientIpKey(headers)).toBe("198.51.100.1");
  });

  it("falls back to a shared bucket rather than to no limit at all", () => {
    expect(clientIpKey(new Headers())).toBe("unknown");
  });
});
