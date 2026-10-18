import { beforeEach, describe, expect, it, vi } from "vitest";

const enforceRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));

const { enforceTradeCreateLimits } = await import("./create-limits");
const { MAX_TRADES_CREATED_PER_HOUR } = await import("@/lib/limits");

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue(null);
});

describe("enforceTradeCreateLimits", () => {
  it("checks the per-minute burst, then the hourly cap, per user", async () => {
    expect(await enforceTradeCreateLimits("user-1")).toBeNull();
    expect(enforceRateLimit.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      ["trades-create:user-1", 60, 60_000],
      ["trades-create-hour:user-1", MAX_TRADES_CREATED_PER_HOUR, 3_600_000],
    ]);
  });

  it("returns the burst 429 without spending an hourly slot", async () => {
    const burst = new Response(null, { status: 429 });
    enforceRateLimit.mockResolvedValueOnce(burst);
    expect(await enforceTradeCreateLimits("user-1")).toBe(burst);
    expect(enforceRateLimit).toHaveBeenCalledTimes(1);
  });

  it("returns the hourly 429, whose message points to Import", async () => {
    const hourly = new Response(null, { status: 429 });
    enforceRateLimit.mockResolvedValueOnce(null).mockResolvedValueOnce(hourly);
    expect(await enforceTradeCreateLimits("user-1")).toBe(hourly);
    expect(enforceRateLimit.mock.calls[1][3]).toMatch(/use Import/);
  });
});
