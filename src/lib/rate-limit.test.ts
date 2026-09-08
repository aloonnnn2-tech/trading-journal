import { describe, it, expect, vi, afterEach } from "vitest";
import { clientIpKey, enforceRateLimit, rateLimit } from "./rate-limit";

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows up to the limit, then blocks", () => {
    const key = `test-${Math.random()}`;
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(false);
  });

  it("reports a positive retry-after when blocked", () => {
    const key = `test-${Math.random()}`;
    rateLimit(key, 1, 60_000);
    const blocked = rateLimit(key, 1, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keys are independent -- one user can't exhaust another's budget", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    expect(rateLimit(a, 1, 60_000).ok).toBe(true);
    expect(rateLimit(a, 1, 60_000).ok).toBe(false);
    expect(rateLimit(b, 1, 60_000).ok).toBe(true);
  });

  // The window has to actually slide, not just reset on a fixed schedule --
  // otherwise a client learns to burst on the boundary.
  it("frees capacity once old hits age out of the window", () => {
    vi.useFakeTimers();
    const key = `test-${Math.random()}`;

    expect(rateLimit(key, 2, 1000).ok).toBe(true);
    expect(rateLimit(key, 2, 1000).ok).toBe(true);
    expect(rateLimit(key, 2, 1000).ok).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(rateLimit(key, 2, 1000).ok).toBe(true);
  });
});

describe("enforceRateLimit", () => {
  it("returns null while under the limit, so the route proceeds", () => {
    const key = `enforce-${Math.random()}`;
    expect(enforceRateLimit(key, 2, 60_000)).toBeNull();
    expect(enforceRateLimit(key, 2, 60_000)).toBeNull();
  });

  it("answers with a 429 carrying Retry-After once over", async () => {
    const key = `enforce-${Math.random()}`;
    enforceRateLimit(key, 1, 60_000);
    const response = enforceRateLimit(key, 1, 60_000);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);

    const retryAfter = Number(response!.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);

    const body = (await response!.json()) as { error: string; retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBe(retryAfter);
  });

  // The whole point of the helper: a 429 a person can read. A bare status code
  // is what the UI used to have nothing to show for.
  it("carries a human-readable message, default or supplied", async () => {
    const key = `enforce-${Math.random()}`;
    enforceRateLimit(key, 1, 60_000);
    const body = (await enforceRateLimit(key, 1, 60_000)!.json()) as { error: string };
    expect(body.error).toMatch(/wait a moment and try again/i);

    const custom = `enforce-${Math.random()}`;
    enforceRateLimit(custom, 1, 60_000, "Too many imports in a row. Give it a minute.");
    const customBody = (await enforceRateLimit(custom, 1, 60_000, "Too many imports in a row. Give it a minute.")!.json()) as {
      error: string;
    };
    expect(customBody.error).toBe("Too many imports in a row. Give it a minute.");
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
