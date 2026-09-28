import { beforeEach, describe, expect, it, vi } from "vitest";

// The holding-period bars route (Phase 4C): signed-in only, the same Yahoo
// rate-limit bucket as the candles route, and nothing but a known bar size
// and a sane range reaches Yahoo.

const getUserIdFromHeader = vi.fn();
const rateLimit = vi.fn();
const fetchYahooBars = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock("@/lib/market-data/yahoo", () => ({ fetchYahooBars: (...a: unknown[]) => fetchYahooBars(...a) }));

const { GET } = await import("./route");

const call = (qs: string) => GET(new Request(`https://tradinglenz.netlify.app/api/market-data/bars?${qs}`));
const GOOD = "ticker=tsla&interval=5m&period1=1788000000&period2=1788500000";

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue("user-1");
  rateLimit.mockResolvedValue({ ok: true });
  fetchYahooBars.mockResolvedValue({ bars: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }], timeZone: "America/New_York" });
});

describe("GET /api/market-data/bars", () => {
  it("refuses without a signed-in user", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await call(GOOD)).status).toBe(401);
    expect(fetchYahooBars).not.toHaveBeenCalled();
  });

  it("counts against the candles route's bucket", async () => {
    await call(GOOD);
    expect(rateLimit).toHaveBeenCalledWith("candles:user-1", 60, 60_000);
  });

  it("stops at the rate limit", async () => {
    rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 12 });
    const res = await call(GOOD);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
  });

  it("returns the bars with their bar size, uppercasing the ticker", async () => {
    const res = await call(GOOD);
    expect(res.status).toBe(200);
    expect(fetchYahooBars).toHaveBeenCalledWith("TSLA", { interval: "5m", period1: 1788000000, period2: 1788500000 });
    expect((await res.json()).interval).toBe("5m");
  });

  it.each([
    ["an unknown bar size", "ticker=TSLA&interval=1m&period1=1&period2=2"],
    ["a missing ticker", "interval=5m&period1=1&period2=2"],
    ["a ticker with odd characters", "ticker=TS%2FLA&interval=5m&period1=1&period2=2"],
    ["a backwards range", "ticker=TSLA&interval=5m&period1=5&period2=2"],
    ["a non-numeric period", "ticker=TSLA&interval=5m&period1=abc&period2=2"],
    ["a span over ten years", `ticker=TSLA&interval=1d&period1=0&period2=${11 * 366 * 86_400}`],
  ])("rejects %s", async (_, qs) => {
    expect((await call(qs)).status).toBe(400);
    expect(fetchYahooBars).not.toHaveBeenCalled();
  });

  it("accepts Yahoo's symbol forms", async () => {
    for (const t of ["BRK.B", "BTC-USD", "EURUSD%3DX", "%5EGSPC"]) {
      expect((await call(`ticker=${t}&interval=1d&period1=1&period2=2`)).status).toBe(200);
    }
  });

  it("404s when Yahoo has nothing for that period", async () => {
    fetchYahooBars.mockResolvedValue({ bars: [], timeZone: "UTC" });
    expect((await call(GOOD)).status).toBe(404);
  });
});
