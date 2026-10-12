import { beforeEach, describe, expect, it, vi } from "vitest";

// A trade that isn't the caller's (RLS hides it) is a 404, the same answer
// every other trade route gives -- not an empty list that reads like "no
// edits yet". Found by the cross-user suite (tests/idor).

const USER = "11111111-1111-4111-8111-111111111111";
const TRADE_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

const getUserIdFromHeader = vi.fn();
const tradeRow = vi.fn();
const listTradeHistory = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tradeRow() }) }) }) }),
  }),
}));
vi.mock("@/lib/trades/history", () => ({ listTradeHistory: (...a: unknown[]) => listTradeHistory(...a) }));

const { GET } = await import("./route");

const call = (id = TRADE_ID) =>
  GET(new Request(`https://x/api/trades/${id}/history`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue(USER);
  tradeRow.mockReturnValue({ id: TRADE_ID });
  listTradeHistory.mockResolvedValue([{ id: "h1" }]);
});

describe("GET /api/trades/[id]/history", () => {
  it("401 without a session", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("404 for a trade the caller cannot see, without reading history", async () => {
    tradeRow.mockReturnValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(listTradeHistory).not.toHaveBeenCalled();
  });

  it("404 for a malformed id", async () => {
    expect((await call("not-a-uuid")).status).toBe(404);
  });

  it("returns the caller's own history", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "h1" }]);
  });
});
