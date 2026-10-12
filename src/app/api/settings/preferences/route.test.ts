import { beforeEach, describe, expect, it, vi } from "vitest";

// Setup -> Settings' save route: signed-in only, a strict boolean, and a
// clear answer (not a crash) while migration 0052 isn't applied.

const getUserIdFromHeader = vi.fn();
const enforceRateLimit = vi.fn();
const setShowTradeSummary = vi.fn();
const savePreferences = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));
vi.mock("@/lib/settings/trade-summary", () => ({ setShowTradeSummary: (...a: unknown[]) => setShowTradeSummary(...a) }));
vi.mock("@/lib/settings/preferences-queries", () => ({ savePreferences: (...a: unknown[]) => savePreferences(...a) }));

const { PATCH } = await import("./route");

const call = (body: unknown) =>
  PATCH(new Request("https://tradinglenz.netlify.app/api/settings/preferences", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue("user-1");
  enforceRateLimit.mockResolvedValue(null);
  setShowTradeSummary.mockResolvedValue(undefined);
  savePreferences.mockImplementation(async (_s: unknown, _u: unknown, patch: object) => ({ merged: true, ...patch }));
});

describe("PATCH /api/settings/preferences", () => {
  it("refuses without a signed-in user", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await call({ showTradeSummary: false })).status).toBe(401);
    expect(setShowTradeSummary).not.toHaveBeenCalled();
  });

  it("saves the switch for the signed-in user", async () => {
    const res = await call({ showTradeSummary: false });
    expect(res.status).toBe(200);
    expect(setShowTradeSummary).toHaveBeenCalledWith({}, "user-1", false);
    expect(await res.json()).toEqual({ ok: true, showTradeSummary: false });
  });

  it.each([[{}], [{ showTradeSummary: "false" }], [{ showTradeSummary: 0 }], [null]])("rejects %j", async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(setShowTradeSummary).not.toHaveBeenCalled();
  });

  it("says the setting isn't available while 0052 is unapplied", async () => {
    setShowTradeSummary.mockRejectedValue({ code: "PGRST204" });
    expect((await call({ showTradeSummary: true })).status).toBe(503);
  });

  it("saves a subset of the preferences object", async () => {
    const res = await call({ preferences: { keyboardShortcuts: false, theme: "dark" } });
    expect(res.status).toBe(200);
    expect(savePreferences).toHaveBeenCalledWith({}, "user-1", { keyboardShortcuts: false, theme: "dark" });
    expect((await res.json()).preferences).toMatchObject({ merged: true, keyboardShortcuts: false });
  });

  it.each([
    [{ preferences: {} }],
    [{ preferences: { keyboardShortcuts: "no" } }],
    [{ preferences: { theme: "sepia" } }],
    [{ preferences: { isAdmin: true } }],
    [{ plan: "paid" }],
  ])("rejects %j without saving anything", async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(savePreferences).not.toHaveBeenCalled();
    expect(setShowTradeSummary).not.toHaveBeenCalled();
  });

  it("says preferences aren't available while 0054 is unapplied", async () => {
    savePreferences.mockRejectedValue({ code: "42703" });
    expect((await call({ preferences: { hoverMotion: false } })).status).toBe(503);
  });

  it("stops at the rate limit", async () => {
    enforceRateLimit.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await call({ showTradeSummary: true })).status).toBe(429);
  });
});
