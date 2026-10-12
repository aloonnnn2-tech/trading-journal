import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH on a strategy that isn't the caller's used to answer 400 "A strategy
// with that name already exists" -- every error was reported as a name
// clash. Now: no row is 404, a real clash (23505) is 400, anything else 500.
// Found by the cross-user suite (tests/idor).

const STRATEGY_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";
const updateStrategy = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: async () => "u1" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/strategies/queries", () => ({
  updateStrategy: (...a: unknown[]) => updateStrategy(...a),
  deleteStrategy: async () => true,
}));

const { PATCH } = await import("./route");

const call = () =>
  PATCH(
    new Request(`https://x/api/strategies/${STRATEGY_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Breakout" }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: STRATEGY_ID }) },
  );

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/strategies/[id]", () => {
  it("404 when no row matched (missing, or another user's)", async () => {
    updateStrategy.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("400 only for a genuine duplicate name", async () => {
    updateStrategy.mockRejectedValue({ code: "23505" });
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already exists/);
  });

  it("500 for any other database error, not a misleading name clash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    updateStrategy.mockRejectedValue({ code: "PGRST116" });
    expect((await call()).status).toBe(500);
  });

  it("returns the updated strategy", async () => {
    updateStrategy.mockResolvedValue({ id: STRATEGY_ID, name: "Breakout" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: STRATEGY_ID, name: "Breakout" });
  });
});
