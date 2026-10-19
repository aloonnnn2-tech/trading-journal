import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  UpstreamUnavailableError,
  backoffDelay,
  isRetryableStatus,
  resilientFetch,
  retryAfterMs,
} from "./resilient-fetch";

const noSleep = async () => {};

/** A fetch that answers from a script, one entry per call. */
function scripted(steps: (number | "network" | "hang" | { status: number; retryAfter?: string })[]) {
  let calls = 0;
  const impl = (async (_url: string, init?: RequestInit) => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls++;
    if (step === "network") throw new TypeError("fetch failed");
    if (step === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    const s = typeof step === "number" ? { status: step } : step;
    return new Response("{}", { status: s.status, headers: s.retryAfter ? { "retry-after": s.retryAfter } : {} });
  }) as typeof fetch;
  return { impl, calls: () => calls };
}

const base = { upstream: "Test", timeoutMs: 50, sleep: noSleep };

describe("isRetryableStatus", () => {
  it("retries rate limits and server errors only", () => {
    expect([429, 500, 502, 503].every(isRetryableStatus)).toBe(true);
    expect([200, 400, 401, 404].some(isRetryableStatus)).toBe(false);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially, is jittered, and is capped", () => {
    expect(backoffDelay(0, 300, 2000, () => 0.999)).toBe(299);
    expect(backoffDelay(2, 300, 2000, () => 0.999)).toBe(1198);
    expect(backoffDelay(10, 300, 2000, () => 0.999)).toBe(1998);
    expect(backoffDelay(3, 300, 2000, () => 0)).toBe(0);
  });
});

describe("retryAfterMs", () => {
  it("reads seconds and HTTP dates", () => {
    expect(retryAfterMs("3")).toBe(3000);
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(retryAfterMs("Fri, 16 Oct 2026 12:00:05 GMT", now)).toBe(5000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
  });
});

describe("resilientFetch", () => {
  it("returns a real answer, a 404 included -- that means 'no such thing', not 'down'", async () => {
    const f = scripted([404]);
    const res = await resilientFetch("u", {}, { ...base, idempotent: true, fetchImpl: f.impl });
    expect(res.status).toBe(404);
    expect(f.calls()).toBe(1);
  });

  it("retries an idempotent call through network errors and 5xx, at most 3 attempts", async () => {
    const ok = scripted(["network", 503, 200]);
    expect((await resilientFetch("u", {}, { ...base, idempotent: true, fetchImpl: ok.impl })).status).toBe(200);
    expect(ok.calls()).toBe(3);

    const down = scripted([500]);
    await expect(resilientFetch("u", {}, { ...base, idempotent: true, fetchImpl: down.impl })).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    expect(down.calls()).toBe(3);
  });

  it("never retries a call that isn't idempotent", async () => {
    const f = scripted([503, 200]);
    await expect(resilientFetch("u", {}, { ...base, idempotent: false, fetchImpl: f.impl })).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    expect(f.calls()).toBe(1);
  });

  it("times out a hung attempt", async () => {
    const f = scripted(["hang"]);
    await expect(resilientFetch("u", {}, { ...base, idempotent: true, attempts: 1, fetchImpl: f.impl })).rejects.toThrow(
      /no answer within 50ms/,
    );
  });

  it("honours a short Retry-After, and gives up on one longer than it will wait", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const short = scripted([{ status: 429, retryAfter: "1" }, 200]);
    await resilientFetch("u", {}, { ...base, sleep, idempotent: true, maxDelayMs: 2000, random: () => 0, fetchImpl: short.impl });
    expect(waits).toEqual([1000]);

    const long = scripted([{ status: 429, retryAfter: "60" }, 200]);
    await expect(
      resilientFetch("u", {}, { ...base, idempotent: true, maxDelayMs: 2000, fetchImpl: long.impl }),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
    expect(long.calls()).toBe(1);
  });

  it("stops calling an upstream that keeps failing, then tries again after the cooldown", async () => {
    let now = 0;
    const breaker = new CircuitBreaker(2, 1000, () => now);
    const down = scripted([500]);
    const call = () => resilientFetch("u", {}, { ...base, idempotent: false, breaker, fetchImpl: down.impl });

    await expect(call()).rejects.toThrow();
    await expect(call()).rejects.toThrow();
    expect(breaker.state).toBe("open");
    await expect(call()).rejects.toThrow(/temporarily paused/);
    expect(down.calls()).toBe(2); // the paused call never reached the upstream

    now = 1500;
    expect(breaker.state).toBe("half-open");
    const back = scripted([200]);
    await resilientFetch("u", {}, { ...base, idempotent: false, breaker, fetchImpl: back.impl });
    expect(breaker.state).toBe("closed");
  });

  it("passes the caller's own abort through instead of calling it an outage", async () => {
    const controller = new AbortController();
    const f = scripted(["hang"]);
    const pending = resilientFetch("u", { signal: controller.signal }, { ...base, timeoutMs: 5000, idempotent: true, fetchImpl: f.impl });
    controller.abort();
    await expect(pending).rejects.not.toBeInstanceOf(UpstreamUnavailableError);
    expect(f.calls()).toBe(1);
  });
});
