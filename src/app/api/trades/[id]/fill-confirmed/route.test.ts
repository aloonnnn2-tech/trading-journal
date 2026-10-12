import { beforeEach, describe, expect, it, vi } from "vitest";

// Recording "the fill price is answered": only for a trade the caller can see
// AND that is being asked about; never a write from a malformed id.

const USER = "11111111-1111-4111-8111-111111111111";
const TRADE_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

const getUserIdFromHeader = vi.fn();
const result = vi.fn();
const update = vi.fn();
const filters: [string, unknown][] = [];

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: (values: unknown) => {
        update(values);
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return chain;
          },
          select: () => ({ maybeSingle: async () => result() }),
        };
        return chain;
      },
    }),
  }),
}));

const { POST } = await import("./route");

const call = (id = TRADE_ID) =>
  POST(new Request(`https://x/api/trades/${id}/fill-confirmed`, { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  getUserIdFromHeader.mockResolvedValue(USER);
  result.mockReturnValue({ data: { id: TRADE_ID, fill_price_confirmed: true }, error: null });
});

describe("POST /api/trades/[id]/fill-confirmed", () => {
  it("401 without a session", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("404 for a malformed id, without a write", async () => {
    expect((await call("nope")).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("marks only a trade that is being asked about", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ fill_price_confirmed: true });
    expect(filters).toEqual([
      ["id", TRADE_ID],
      ["fill_price_confirmed", false],
    ]);
    expect((await res.json()).fill_price_confirmed).toBe(true);
  });

  it("404 when no such trade is waiting (someone else's, or already answered)", async () => {
    result.mockReturnValue({ data: null, error: null });
    expect((await call()).status).toBe(404);
  });
});
