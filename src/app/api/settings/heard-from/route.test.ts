import { beforeEach, describe, expect, it, vi } from "vitest";

// "How did you hear about us?": signed-in only, one of the fixed answers, and
// saved on the account's own metadata.

const getUserIdFromHeader = vi.fn();
const enforceRateLimit = vi.fn();
const updateUser = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { updateUser } }) }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));

const { POST } = await import("./route");

const call = (body: unknown) =>
  POST(new Request("https://tradinglenz.netlify.app/api/settings/heard-from", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue("user-1");
  enforceRateLimit.mockResolvedValue(null);
  updateUser.mockResolvedValue({ data: {}, error: null });
});

describe("POST /api/settings/heard-from", () => {
  it("refuses without a signed-in user", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await call({ answer: "tiktok" })).status).toBe(401);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("saves the answer on the account", async () => {
    const res = await call({ answer: "tiktok" });
    expect(res.status).toBe(200);
    const data = (updateUser.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.heard_from).toBe("tiktok");
    expect(typeof data.heard_from_at).toBe("string");
  });

  it("records a skip", async () => {
    expect((await call({ answer: "skipped" })).status).toBe(200);
    expect((updateUser.mock.calls[0][0] as { data: Record<string, unknown> }).data.heard_from).toBe("skipped");
  });

  it.each([[{ answer: "reddit" }], [{ answer: "TikTok" }], [{}], [{ answer: "tiktok", plan: "paid" }], [null]])(
    "rejects %j and writes nothing",
    async (body) => {
      expect((await call(body)).status).toBe(400);
      expect(updateUser).not.toHaveBeenCalled();
    },
  );

  it("says so when the save fails", async () => {
    updateUser.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await call({ answer: "youtube" })).status).toBe(500);
  });
});
