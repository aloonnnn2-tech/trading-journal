import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdFromHeader = vi.fn();
const isAdmin = vi.fn();
const createAdminClient = vi.fn();
const enforceRateLimit = vi.fn();
const setHelpStatus = vi.fn();
const deleteHelpRequest = vi.fn();
const recordAudit = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/tracking/admin-queries", () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));
vi.mock("@/lib/admin/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));
vi.mock("@/lib/help/admin-queries", () => ({
  setHelpStatus: (...a: unknown[]) => setHelpStatus(...a),
  deleteHelpRequest: (...a: unknown[]) => deleteHelpRequest(...a),
}));

const { PATCH, DELETE } = await import("./route");

const ID = "3f9a2b4c-1d2e-4f5a-8b6c-7d8e9f0a1b2c";
const req = (method: string, body: unknown) =>
  new Request("https://x/api/admin/help", { method, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue("admin-user");
  isAdmin.mockResolvedValue(true);
  createAdminClient.mockReturnValue({});
  enforceRateLimit.mockResolvedValue(null);
  setHelpStatus.mockResolvedValue(true);
  deleteHelpRequest.mockResolvedValue(true);
});

describe("/api/admin/help", () => {
  it("refuses signed-out and non-admin callers, and never builds the service-role client", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await PATCH(req("PATCH", { id: ID, status: "answered" }))).status).toBe(401);
    getUserIdFromHeader.mockResolvedValue("user-1");
    isAdmin.mockResolvedValue(false);
    expect((await PATCH(req("PATCH", { id: ID, status: "answered" }))).status).toBe(403);
    expect((await DELETE(req("DELETE", { id: ID }))).status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(setHelpStatus).not.toHaveBeenCalled();
  });

  it("marks a request answered and records who did it", async () => {
    const res = await PATCH(req("PATCH", { id: ID, status: "answered" }));
    expect(res.status).toBe(200);
    expect(setHelpStatus).toHaveBeenCalledWith({}, ID, "answered");
    expect(recordAudit).toHaveBeenCalledWith(
      { actorId: "admin-user", action: "help_update", target: ID, detail: { status: "answered" } },
      {},
    );
  });

  it("refuses an unknown status or a bad id", async () => {
    expect((await PATCH(req("PATCH", { id: ID, status: "deleted" }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { id: "1; drop table", status: "open" }))).status).toBe(400);
    expect(setHelpStatus).not.toHaveBeenCalled();
  });

  it("deletes a request, 404 when it's already gone", async () => {
    expect((await DELETE(req("DELETE", { id: ID }))).status).toBe(200);
    expect(recordAudit).toHaveBeenCalledWith({ actorId: "admin-user", action: "help_remove", target: ID }, {});
    deleteHelpRequest.mockResolvedValue(false);
    expect((await DELETE(req("DELETE", { id: ID }))).status).toBe(404);
  });
});
