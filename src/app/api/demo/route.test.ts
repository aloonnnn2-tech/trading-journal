import { beforeEach, describe, expect, it, vi } from "vitest";

// The demo journal's three answers (Phase 4D), with the database mocked at
// the boundary: the state machine itself lives in migration 0051's
// functions, so this pins what the route asks for and how it reports the
// answer.

const getUserIdFromHeader = vi.fn();
const enforceRateLimit = vi.fn();
const rpc = vi.fn();
const remove = vi.fn();
const imageRows = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: async () => ({ data: imageRows() }) }),
    storage: { from: () => ({ remove: (...a: unknown[]) => remove(...a) }) },
  }),
}));

const { POST } = await import("./route");

const call = (body: unknown) =>
  POST(new Request("https://tradinglenz.netlify.app/api/demo", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue("user-1");
  enforceRateLimit.mockResolvedValue(null);
  rpc.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  imageRows.mockReturnValue([]);
});

describe("POST /api/demo", () => {
  it("refuses without a signed-in user", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await call({ action: "start" })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an unknown action", async () => {
    expect((await call({ action: "reset" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("seeds the demo journal on start", async () => {
    const res = await call({ action: "start" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, state: "active" });
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("seed_demo_journal");
    expect((args as { payload: { trades: unknown[] } }).payload.trades.length).toBeGreaterThanOrEqual(50);
  });

  it("records a decline", async () => {
    const res = await call({ action: "decline" });
    expect(rpc).toHaveBeenCalledWith("decline_demo_journal");
    expect(await res.json()).toEqual({ ok: true, state: "declined" });
  });

  it("finishes, then removes the screenshots uploaded while trying it", async () => {
    imageRows.mockReturnValue([{ storage_path: "user-1/a.png" }, { storage_path: "user-1/b.png" }]);
    const res = await call({ action: "finish" });
    expect(rpc).toHaveBeenCalledWith("finish_demo_journal");
    expect(remove).toHaveBeenCalledWith(["user-1/a.png", "user-1/b.png"]);
    expect(await res.json()).toEqual({ ok: true, state: "done" });
  });

  it("leaves the files alone when the database refuses", async () => {
    imageRows.mockReturnValue([{ storage_path: "user-1/a.png" }]);
    rpc.mockResolvedValue({ error: { code: "P0001", hint: "demo_not_active" } });
    const res = await call({ action: "finish" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Already answered.", reason: "demo_not_active" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("reports a missing migration instead of crashing", async () => {
    rpc.mockResolvedValue({ error: { code: "PGRST202" } });
    expect((await call({ action: "start" })).status).toBe(503);
  });

  it("stops at the rate limit", async () => {
    enforceRateLimit.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await call({ action: "start" })).status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });
});
