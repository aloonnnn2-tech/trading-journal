import { beforeEach, describe, expect, it, vi } from "vitest";

const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));

const { DAILY_CAPS, enforceDailyCap, enforceYahooCeiling, YAHOO_GLOBAL_PER_MINUTE } = await import("./daily");

beforeEach(() => rateLimit.mockReset());

describe("enforceDailyCap", () => {
  it("counts against a per-user, per-feature, 24-hour bucket", async () => {
    rateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
    expect(await enforceDailyCap("ocr", "u1")).toBeNull();
    expect(rateLimit).toHaveBeenCalledWith("daily:ocr:u1", DAILY_CAPS.ocr.limit, 86_400_000);
  });

  it("answers 429 with Retry-After and a sentence a person can act on", async () => {
    rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 5 * 3600 });
    const res = await enforceDailyCap("import", "u1");
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe(String(5 * 3600));
    const body = await res!.json();
    expect(body.error).toBe("You've reached today's limit of 100 imports. It resets in about 5 hours.");
  });

  it("says 'within the hour' rather than 'in about 1 hours'", async () => {
    rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 120 });
    const body = await (await enforceDailyCap("export", "u1"))!.json();
    expect(body.error).toMatch(/resets within the hour\.$/);
  });

  it("keeps every cap far above a person's day (sanity floor)", () => {
    for (const [feature, cap] of Object.entries(DAILY_CAPS)) {
      expect(cap.limit, feature).toBeGreaterThanOrEqual(50);
    }
  });
});

describe("enforceYahooCeiling", () => {
  it("is one bucket shared by every user", async () => {
    rateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
    expect(await enforceYahooCeiling()).toBeNull();
    expect(rateLimit).toHaveBeenCalledWith("upstream:yahoo", YAHOO_GLOBAL_PER_MINUTE, 60_000);
  });

  it("answers 429 when the app as a whole is over", async () => {
    rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const res = await enforceYahooCeiling();
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("30");
  });
});
