import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdFromHeader = vi.fn();
const isAdmin = vi.fn();
const createAdminClient = vi.fn();
const enforceRateLimit = vi.fn();
const listWaitlist = vi.fn();
const removeWaitlistEntry = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/tracking/admin-queries", () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));
vi.mock("@/lib/waitlist/admin-queries", () => ({
  listWaitlist: (...a: unknown[]) => listWaitlist(...a),
  removeWaitlistEntry: (...a: unknown[]) => removeWaitlistEntry(...a),
}));

const { GET, DELETE } = await import("./route");

const ID = "3f9a2b4c-1d2e-4f5a-8b6c-7d8e9f0a1b2c";
const del = (body: unknown) =>
  DELETE(new Request("https://x/api/admin/waitlist", { method: "DELETE", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue("admin-user");
  isAdmin.mockResolvedValue(true);
  createAdminClient.mockReturnValue({});
  enforceRateLimit.mockResolvedValue(null);
  listWaitlist.mockResolvedValue({
    entries: [{ id: ID, email: "a@example.com", source: "home-paid-card", created_at: "2026-09-27T10:00:00+00:00" }],
    total: 1,
  });
  removeWaitlistEntry.mockResolvedValue(true);
});

describe("access, for both GET and DELETE", () => {
  it("refuses a signed-out caller with 401 and never reaches the data", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await del({ id: ID })).status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a signed-in non-admin with 403 and never builds the service-role client", async () => {
    isAdmin.mockResolvedValue(false);
    expect((await GET()).status).toBe(403);
    expect((await del({ id: ID })).status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(listWaitlist).not.toHaveBeenCalled();
    expect(removeWaitlistEntry).not.toHaveBeenCalled();
  });

  it("answers 501 when the service-role key is missing", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("no key");
    });
    expect((await GET()).status).toBe(501);
  });

  it("passes the limiter's 429 through", async () => {
    enforceRateLimit.mockResolvedValue(Response.json({}, { status: 429 }));
    expect((await GET()).status).toBe(429);
  });
});

describe("GET: the CSV download", () => {
  it("returns the list as an uncached CSV attachment", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="trading-lens-waitlist-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe(
      "email,source,joined_at\r\na@example.com,home-paid-card,2026-09-27T10:00:00+00:00\r\n",
    );
  });
});

describe("DELETE: removing an address", () => {
  it("removes by id", async () => {
    const res = await del({ id: ID });
    expect(res.status).toBe(200);
    expect(removeWaitlistEntry).toHaveBeenCalledWith({}, ID);
  });

  it("answers 404 for an id that isn't there", async () => {
    removeWaitlistEntry.mockResolvedValue(false);
    expect((await del({ id: ID })).status).toBe(404);
  });

  it("rejects anything that isn't a uuid, without touching the table", async () => {
    for (const body of [{ id: "1 or 1=1" }, { id: "" }, {}, { email: "a@example.com" }]) {
      expect((await del(body)).status).toBe(400);
    }
    expect(removeWaitlistEntry).not.toHaveBeenCalled();
  });
});
