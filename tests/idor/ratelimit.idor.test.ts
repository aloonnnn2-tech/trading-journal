/**
 * The limiter holds across serverless instances (Phase 2, "Done when").
 *
 * Two separately loaded copies of src/lib/rate-limit.ts -- each with its own
 * module state and its own database client, exactly what two warm Netlify
 * instances are -- hit one bucket on the DEV project. If the counter lived in
 * memory, each copy would allow `limit` requests; because it lives in
 * Postgres (0042), the second copy sees the first one's hits.
 */
import { describe, expect, it, vi } from "vitest";

async function freshLimiter() {
  vi.resetModules();
  return import("@/lib/rate-limit");
}

describe("global rate limiter on the dev project", () => {
  it("a second instance sees the first instance's hits", async () => {
    const bucket = `itest:${crypto.randomUUID()}`;
    const one = await freshLimiter();
    const two = await freshLimiter();
    expect(one.rateLimit).not.toBe(two.rateLimit);

    for (let i = 0; i < 3; i++) expect((await one.rateLimit(bucket, 5, 60_000)).ok).toBe(true);
    for (let i = 0; i < 2; i++) expect((await two.rateLimit(bucket, 5, 60_000)).ok).toBe(true);

    const sixth = await two.rateLimit(bucket, 5, 60_000);
    expect(sixth.ok).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(60);

    // And the first instance is refused too.
    expect((await one.rateLimit(bucket, 5, 60_000)).ok).toBe(false);
  });

  it("enforceRateLimit's 429 carries a non-zero Retry-After", async () => {
    const bucket = `itest:${crypto.randomUUID()}`;
    const { enforceRateLimit } = await freshLimiter();
    expect(await enforceRateLimit(bucket, 1, 60_000)).toBeNull();
    const res = await enforceRateLimit(bucket, 1, 60_000);
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("a daily cap counts per user and per feature", async () => {
    vi.resetModules();
    const { enforceDailyCap, DAILY_CAPS } = await import("@/lib/rate-limits/daily");
    const user = crypto.randomUUID();
    // Use the smallest cap so the test stays quick.
    const [feature, cap] = Object.entries(DAILY_CAPS).sort((a, b) => a[1].limit - b[1].limit)[0] as [
      keyof typeof DAILY_CAPS,
      { limit: number },
    ];
    for (let i = 0; i < cap.limit; i++) expect(await enforceDailyCap(feature, user)).toBeNull();
    const over = await enforceDailyCap(feature, user);
    expect(over?.status).toBe(429);
    // A different user is unaffected.
    expect(await enforceDailyCap(feature, crypto.randomUUID())).toBeNull();
  }, 120_000);
});
