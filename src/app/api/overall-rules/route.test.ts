import { beforeEach, describe, expect, it, vi } from "vitest";

// Overall rules: free, signed-in only, validated, and the batch check limited.

const USER = "11111111-1111-4111-8111-111111111111";
const RULE_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

const getUserIdFromHeader = vi.fn();
const listOverallRules = vi.fn();
const createOverallRule = vi.fn();
const updateOverallRule = vi.fn();
const deleteOverallRule = vi.fn();
const refreshMarketChecks = vi.fn();
const rateLimit = vi.fn();
const enforceDailyCap = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/fetch-all", () => ({ fetchAllRows: async () => [{ id: "t1" }] }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock("@/lib/rate-limits/daily", () => ({ enforceDailyCap: (...a: unknown[]) => enforceDailyCap(...a) }));
vi.mock("@/lib/overall-rules/queries", () => ({
  listOverallRules: (...a: unknown[]) => listOverallRules(...a),
  createOverallRule: (...a: unknown[]) => createOverallRule(...a),
  updateOverallRule: (...a: unknown[]) => updateOverallRule(...a),
  deleteOverallRule: (...a: unknown[]) => deleteOverallRule(...a),
  refreshMarketChecks: (...a: unknown[]) => refreshMarketChecks(...a),
}));

const list = await import("./route");
const one = await import("./[id]/route");
const check = await import("./check/route");

const post = (body: unknown) =>
  list.POST(new Request("https://x/api/overall-rules", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue(USER);
  rateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
  enforceDailyCap.mockResolvedValue(null);
  listOverallRules.mockResolvedValue([]);
  createOverallRule.mockImplementation(async (_s, _u, input) => ({ id: RULE_ID, ...input }));
  refreshMarketChecks.mockResolvedValue({ stored: [], summary: { checked: 2, deferred: 0, noData: 0 } });
});

describe("/api/overall-rules", () => {
  it("401 without a session, for every route", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await list.GET()).status).toBe(401);
    expect((await post({ kind: "text", label: "x" })).status).toBe(401);
    expect((await check.POST()).status).toBe(401);
    expect((await one.DELETE(new Request("https://x"), { params: Promise.resolve({ id: RULE_ID }) })).status).toBe(401);
  });

  it("creates a rule for the caller, keeping only its kind's columns", async () => {
    const res = await post({ kind: "ma_exit", label: "Exit below SMA 150", ma_type: "sma", ma_period: 150, number_value: 3 });
    expect(res.status).toBe(201);
    const [, userId, input] = createOverallRule.mock.calls[0];
    expect(userId).toBe(USER);
    expect(input).toMatchObject({ kind: "ma_exit", ma_period: 150, number_value: null, grace_days: 1 });
  });

  it("400 with the reason for a malformed rule; never a user_id from the body", async () => {
    const bad = await post({ kind: "ma_exit", label: "x", ma_type: "sma" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Enter the number of days.");
    expect((await post({ kind: "text", label: "x", user_id: "someone" })).status).toBe(400);
    expect(createOverallRule).not.toHaveBeenCalled();
  });

  it("503 before migration 0081", async () => {
    listOverallRules.mockResolvedValue(null);
    expect((await list.GET()).status).toBe(503);
    expect((await check.POST()).status).toBe(503);
  });

  it("404 for a malformed id or a rule that isn't the caller's", async () => {
    const res = await one.DELETE(new Request("https://x"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    deleteOverallRule.mockResolvedValue(false);
    expect((await one.DELETE(new Request("https://x"), { params: Promise.resolve({ id: RULE_ID }) })).status).toBe(404);
  });

  it("the batch check is rate-limited, capped per day, and capped per run", async () => {
    const res = await check.POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 2, deferred: 0, noData: 0 });
    expect(refreshMarketChecks.mock.calls[0][4]).toEqual({ maxSymbols: 30 });
    expect(enforceDailyCap).toHaveBeenCalledWith("rule-checks", USER);

    rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 120 });
    expect((await check.POST()).status).toBe(429);
  });
});
