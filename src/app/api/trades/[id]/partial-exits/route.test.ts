import { beforeEach, describe, expect, it, vi } from "vitest";

// Logging a partial sell: only on the caller's own trade (RLS, through
// getTrade), only a well-formed sale, and every refusal from updateTrade's
// check reaches the user as a plain message.

const USER = "11111111-1111-4111-8111-111111111111";
const TRADE_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

const getUserIdFromHeader = vi.fn();
const getTrade = vi.fn();
const updateTrade = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/lib/tracking/log", () => ({ logEvent: async () => {}, SERVER_SESSION_ID: "server" }));
vi.mock("@/lib/trades/queries", async () => {
  class PartialExitsError extends Error {}
  class TradeConflictError extends Error {
    current = {};
  }
  return {
    getTrade: (...args: unknown[]) => getTrade(...args),
    updateTrade: (...args: unknown[]) => updateTrade(...args),
    PartialExitsError,
    TradeConflictError,
  };
});

const { POST, PATCH, DELETE } = await import("./route");
const { PartialExitsError } = await import("@/lib/trades/queries");

const goodSale = { date: "2026-10-20T15:00:00Z", shares: 40, price: 60, reason: "earnings", note: "  before ER  " };

function call(handler: typeof POST, body: unknown, id = TRADE_ID) {
  return handler(
    new Request(`https://x/api/trades/${id}/partial-exits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** Runs the op updateTrade was given against `current`. */
function opResult(current: unknown[]) {
  const changes = updateTrade.mock.calls[0][2] as { partialExits: (c: unknown[]) => unknown[] };
  return changes.partialExits(current);
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue(USER);
  getTrade.mockResolvedValue({ id: TRADE_ID, partial_exits: [] });
  updateTrade.mockResolvedValue({ id: TRADE_ID, partial_exits: ["saved"] });
});

describe("/api/trades/[id]/partial-exits", () => {
  it("401 without a session", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await call(POST, { sale: goodSale })).status).toBe(401);
    expect(updateTrade).not.toHaveBeenCalled();
  });

  it("404 for a malformed id, never reaching the database", async () => {
    expect((await call(POST, { sale: goodSale }, "nope")).status).toBe(404);
    expect(getTrade).not.toHaveBeenCalled();
  });

  it("404 for someone else's trade (RLS hides it)", async () => {
    getTrade.mockResolvedValue(null);
    expect((await call(POST, { sale: goodSale })).status).toBe(404);
    expect(updateTrade).not.toHaveBeenCalled();
  });

  it("400 for a malformed sale, naming the field", async () => {
    const res = await call(POST, { sale: { ...goodSale, shares: -5 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^shares:/);
    expect((await call(POST, "{nope")).status).toBe(400);
    expect((await call(POST, { sale: goodSale, extra: 1 })).status).toBe(400);
    expect(updateTrade).not.toHaveBeenCalled();
  });

  it("503 until migration 0079 is applied", async () => {
    getTrade.mockResolvedValue({ id: TRADE_ID });
    const res = await call(POST, { sale: goodSale });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/0079/);
  });

  it("logs a sale: a server-made id, the note trimmed, the date normalised", async () => {
    const res = await call(POST, { sale: goodSale });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: TRADE_ID, partial_exits: ["saved"] });
    const [added] = opResult([]) as Record<string, unknown>[];
    expect(added).toMatchObject({
      date: "2026-10-20T15:00:00.000Z",
      shares: 40,
      price: 60,
      reason: "earnings",
      note: "before ER",
      fee: null,
    });
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("400 with the reason when the sale doesn't fit the trade", async () => {
    updateTrade.mockRejectedValue(new PartialExitsError("You hold 100 shares."));
    const res = await call(POST, { sale: goodSale });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("You hold 100 shares.");
  });

  it("changes one sale and keeps the others", async () => {
    await call(PATCH, { id: "a", sale: { ...goodSale, shares: 10 } });
    const next = opResult([
      { id: "a", shares: 40 },
      { id: "b", shares: 5 },
    ]) as { id: string; shares: number }[];
    expect(next).toEqual([expect.objectContaining({ id: "a", shares: 10 }), { id: "b", shares: 5 }]);
  });

  it("removes one sale", async () => {
    await call(DELETE, { id: "a" });
    expect(opResult([{ id: "a" }, { id: "b" }])).toEqual([{ id: "b" }]);
  });

  it("404 when the sale to change is already gone", async () => {
    updateTrade.mockImplementation(async (_s, _id, changes: { partialExits: (c: unknown[]) => unknown[] }) =>
      changes.partialExits([{ id: "b" }]),
    );
    const res = await call(DELETE, { id: "a" });
    expect(res.status).toBe(404);
  });
});
