import { beforeEach, describe, expect, it, vi } from "vitest";

// The panel route's access decisions, with every dependency mocked at the
// boundary: no sign-in is a 401, a malformed id never reaches Postgres, and a
// trade that isn't the caller's is a 404 even if a query ever returned it.

const USER = "11111111-1111-4111-8111-111111111111";
const TRADE_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

const getUserIdFromHeader = vi.fn();
const getTrade = vi.fn();
const enforceRateLimit = vi.fn();
const createSignedUrls = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ storage: { from: () => ({ createSignedUrls: (...a: unknown[]) => createSignedUrls(...a) }) } }),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));
vi.mock("@/lib/trades/queries", () => ({ getTrade: (...a: unknown[]) => getTrade(...a) }));
vi.mock("@/lib/trades/history", () => ({ listTradeHistory: async () => [] }));
vi.mock("@/lib/fields/definitions", () => ({
  listFieldDefinitions: async () => [{ key: "notes", label: "Notes", field_type: "large_notes" }],
}));
vi.mock("@/lib/images/queries", () => ({
  listTradeImages: async () => [{ id: "img-1", storage_path: `${USER}/shot.png` }],
}));
vi.mock("@/lib/strategies/queries", () => ({
  listTradeStrategyIds: async () => ["s1"],
  listStrategies: async () => [{ id: "s1", name: "Breakout" }],
}));
vi.mock("@/lib/plan-rules/queries", () => ({ listRulesForStrategies: async () => ({ s1: [] }) }));

const { GET } = await import("./route");

function call(id = TRADE_ID) {
  return GET(new Request(`https://tradinglenz.netlify.app/api/trades/${id}/panel`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue(USER);
  enforceRateLimit.mockResolvedValue(null);
  createSignedUrls.mockResolvedValue({ data: [{ path: `${USER}/shot.png`, signedUrl: "https://signed.example/shot" }] });
  getTrade.mockResolvedValue({
    id: TRADE_ID,
    user_id: USER,
    mode: "trade",
    ticker: "NVDA",
    custom_fields: { notes: "Waited for the retest." },
  });
});

describe("GET /api/trades/[id]/panel", () => {
  it("refuses without a signed-in user", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(getTrade).not.toHaveBeenCalled();
  });

  it("404s a malformed id without querying", async () => {
    const res = await call("import");
    expect(res.status).toBe(404);
    expect(getTrade).not.toHaveBeenCalled();
  });

  it("404s a trade that doesn't exist or isn't visible", async () => {
    getTrade.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("404s someone else's trade, even if a query returned it", async () => {
    getTrade.mockResolvedValue({ id: TRADE_ID, user_id: "22222222-2222-4222-8222-222222222222", mode: "trade", custom_fields: {} });
    const res = await call();
    expect(res.status).toBe(404);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("returns the panel's data for the caller's own trade, uncached", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.trade.ticker).toBe("NVDA");
    expect(body.strategyNames).toEqual(["Breakout"]);
    expect(body.hasStrategies).toBe(true);
    expect(body.adherences).toEqual([]);
    expect(body.images).toEqual([{ id: "img-1", url: "https://signed.example/shot" }]);
    expect(body.textFields).toEqual([{ key: "notes", label: "Notes", value: "Waited for the retest." }]);
  });

  it("stops at the rate limit", async () => {
    enforceRateLimit.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await call()).status).toBe(429);
    expect(getTrade).not.toHaveBeenCalled();
  });
});
