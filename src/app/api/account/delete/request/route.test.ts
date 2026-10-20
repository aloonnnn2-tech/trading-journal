import { beforeEach, describe, expect, it, vi } from "vitest";

// Step 1 of deleting an account: record the request, email the link to the
// account's own address. Nothing is deleted here.

const getUserIdFromHeader = vi.fn();
const enforceRateLimit = vi.fn();
const getUser = vi.fn();
const upsert = vi.fn();
const signInWithOtp = vi.fn();
const createAdminClient = vi.fn(() => ({ from: (t: string) => (expect(t).toBe("account_deletion_requests"), { upsert }) }));

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: () => getUser() } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
  rateLimit: vi.fn(),
  clientIpKey: () => "unknown",
}));
vi.mock("@/lib/auth/server-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/server-auth")>()),
  authClient: async () => ({ auth: { signInWithOtp: (...a: unknown[]) => signInWithOtp(...a) } }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const { POST } = await import("./route");
const { hashDeletionToken } = await import("@/lib/account/deletion-proof");

const post = (body: unknown = { captchaToken: "tok" }) =>
  POST(new Request("https://x/api/account/delete/request", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue("user-1");
  enforceRateLimit.mockResolvedValue(null);
  getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "me@example.com" } }, error: null });
  upsert.mockResolvedValue({ error: null });
  signInWithOtp.mockResolvedValue({ data: {}, error: null });
});

describe("POST /api/account/delete/request", () => {
  it("records a one-hour request and emails the link to the account's OWN address", async () => {
    const before = Date.now();
    const res = await post({ captchaToken: "tok", email: "attacker@evil.example" });
    expect(res.status).toBe(200);
    const row = upsert.mock.calls[0][0];
    expect(row.user_id).toBe("user-1");
    const window = Date.parse(row.expires_at) - Date.parse(row.requested_at);
    expect(window).toBe(60 * 60_000);
    expect(Date.parse(row.requested_at)).toBeGreaterThanOrEqual(before - 1000);
    // The link ends in a fresh code; only its hash is stored, and the code
    // is never in the response.
    const options = signInWithOtp.mock.calls[0][0].options;
    expect(signInWithOtp.mock.calls[0][0].email).toBe("me@example.com");
    expect(options).toMatchObject({ shouldCreateUser: false, captchaToken: "tok" });
    const m = /^https:\/\/x\/account\/delete\/confirm\/([A-Za-z0-9_-]{43})$/.exec(options.emailRedirectTo);
    expect(m).not.toBeNull();
    expect(row.token_hash).toBe(hashDeletionToken(m![1]));
    expect(JSON.stringify(await res.json())).not.toContain(m![1]);
  });

  it("needs a signed-in user", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("is limited per account", async () => {
    enforceRateLimit.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await post()).status).toBe(429);
    expect(enforceRateLimit.mock.calls[0].slice(0, 3)).toEqual(["account-delete-request:user-1", 3, 3_600_000]);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends nothing when the request can't be recorded", async () => {
    upsert.mockResolvedValue({ error: { code: "PGRST205", message: "no table" } });
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/database update/);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("passes on Supabase's code when the email can't be sent (e.g. CAPTCHA), never its message", async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: { code: "captcha_failed", status: 400, message: "detail" } });
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "captcha_failed", status: 400 } });
  });
});
