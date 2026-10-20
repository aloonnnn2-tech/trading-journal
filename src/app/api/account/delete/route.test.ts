import { beforeEach, describe, expect, it, vi } from "vitest";

// Security gaps pass, 5.3: deletion removes the files first and stops if it
// can't, removes the waitlist row, and leaves an audit entry.

const getUserIdFromHeader = vi.fn();
const enforceRateLimit = vi.fn();
const removeUserFiles = vi.fn();
const removeWaitlistEmail = vi.fn();
const recordAudit = vi.fn();
const deleteUser = vi.fn();
const getUserById = vi.fn();
const createAdminClient = vi.fn();

const admin = {
  from: () => ({ select: () => ({ eq: async () => ({ data: [{ storage_path: "user-1/t/a.png" }], error: null }) }) }),
  storage: {},
  auth: { admin: { deleteUser: (...a: unknown[]) => deleteUser(...a), getUserById: (...a: unknown[]) => getUserById(...a) } },
};

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));
vi.mock("@/lib/admin/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));
vi.mock("@/lib/account/delete-account", () => ({
  removeUserFiles: (...a: unknown[]) => removeUserFiles(...a),
  removeWaitlistEmail: (...a: unknown[]) => removeWaitlistEmail(...a),
}));
// The emailed-link proof (2026-10-20) is tested on its own in
// src/lib/account/deletion-proof.test.ts; here only its verdict matters.
const deletionProof = vi.fn();
vi.mock("@/lib/account/deletion-proof", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account/deletion-proof")>()),
  deletionProof: (...a: unknown[]) => deletionProof(...a),
}));

const { DELETE: handler } = await import("./route");
const TOKEN = "t".repeat(43);
const DELETE = (body: unknown = { token: TOKEN }) =>
  handler(new Request("https://x/api/account/delete", { method: "DELETE", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue("user-1");
  enforceRateLimit.mockResolvedValue(null);
  createAdminClient.mockReturnValue(admin);
  removeUserFiles.mockResolvedValue(1);
  removeWaitlistEmail.mockResolvedValue(1);
  getUserById.mockResolvedValue({ data: { user: { email: "t@example.com" } }, error: null });
  deleteUser.mockResolvedValue({ error: null });
  deletionProof.mockResolvedValue({ ok: true });
});

describe("DELETE /api/account/delete", () => {
  it.each(["no_request", "expired", "wrong_link"] as const)(
    "deletes nothing without the emailed-link proof (%s)",
    async (reason) => {
      deletionProof.mockResolvedValue({ ok: false, reason });
      const res = await DELETE();
      expect(res.status).toBe(403);
      expect((await res.json()).reason).toBe(reason);
      expect(removeUserFiles).not.toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );

  it("checks the code from the request body, for the signed-in account", async () => {
    await DELETE();
    expect(deletionProof).toHaveBeenCalledWith(admin, "user-1", TOKEN);
  });

  it("treats a missing or unreadable body as no code", async () => {
    deletionProof.mockResolvedValue({ ok: false, reason: "wrong_link" });
    await handler(new Request("https://x/api/account/delete", { method: "DELETE" }));
    expect(deletionProof).toHaveBeenCalledWith(admin, "user-1", null);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("removes files, the waitlist row and the user, then records it", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(removeUserFiles).toHaveBeenCalledWith(admin.storage, "user-1", ["user-1/t/a.png"]);
    expect(removeWaitlistEmail).toHaveBeenCalledWith(admin, "t@example.com");
    expect(deleteUser).toHaveBeenCalledWith("user-1");
    expect(recordAudit).toHaveBeenCalledWith(
      { actorId: "user-1", action: "account_delete", target: "user-1", detail: { files: 1, waitlist: true } },
      admin,
    );
  });

  it("stops before deleting the account when the files can't be removed", async () => {
    removeUserFiles.mockRejectedValue(new Error("storage down"));
    const res = await DELETE();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/nothing was deleted/);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("still deletes the account when only the waitlist clean-up fails", async () => {
    removeWaitlistEmail.mockRejectedValue(new Error("waitlist down"));
    expect((await DELETE()).status).toBe(200);
    expect(deleteUser).toHaveBeenCalled();
  });

  it("changes nothing when the service-role key is missing", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("no key");
    });
    expect((await DELETE()).status).toBe(501);
    expect(removeUserFiles).not.toHaveBeenCalled();
  });

  it("records nothing when the user deletion fails", async () => {
    deleteUser.mockResolvedValue({ error: { message: "x" } });
    expect((await DELETE()).status).toBe(500);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await DELETE()).status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
