import { describe, expect, it } from "vitest";
import { retryAfterSeconds, failureFromStatus } from "./types";

function withHeader(value?: string): Response {
  return new Response(null, { headers: value === undefined ? {} : { "retry-after": value } });
}

describe("retryAfterSeconds", () => {
  it("reads a plain number of seconds", () => {
    expect(retryAfterSeconds(withHeader("30"))).toBe(30);
  });

  it("rounds up, so we never tell the user to retry too early", () => {
    expect(retryAfterSeconds(withHeader("7.2"))).toBe(8);
  });

  it("caps the quoted wait, because an hour is noise rather than advice", () => {
    expect(retryAfterSeconds(withHeader("3600"))).toBe(300);
  });

  it("returns undefined rather than a wrong number for the HTTP-date form", () => {
    expect(retryAfterSeconds(withHeader("Wed, 21 Oct 2026 07:28:00 GMT"))).toBeUndefined();
  });

  it("degrades to undefined for a partial Response rather than throwing", () => {
    // Called while constructing an error; throwing here would mask the real
    // provider failure. The provider tests pass duck-typed fakes.
    expect(retryAfterSeconds({} as Response)).toBeUndefined();
    expect(retryAfterSeconds(undefined as unknown as Response)).toBeUndefined();
    expect(retryAfterSeconds({ headers: {} } as unknown as Response)).toBeUndefined();
  });

  it("ignores absent, empty and non-positive values", () => {
    expect(retryAfterSeconds(withHeader())).toBeUndefined();
    expect(retryAfterSeconds(withHeader("   "))).toBeUndefined();
    expect(retryAfterSeconds(withHeader("0"))).toBeUndefined();
    expect(retryAfterSeconds(withHeader("-5"))).toBeUndefined();
  });
});

describe("failureFromStatus", () => {
  it("treats 429 as a temporary condition, not a bad key", () => {
    // The distinction the ask route now depends on: a rate limit must not be
    // retried with a larger request, and must not park the user's key.
    expect(failureFromStatus(429)).toBe("unavailable");
    expect(failureFromStatus(401)).toBe("invalid_key");
    expect(failureFromStatus(503)).toBe("unavailable");
  });
});
