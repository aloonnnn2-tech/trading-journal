import { beforeEach, describe, expect, it, vi } from "vitest";
import { HELP_LIMITS, HONEYPOT_FIELD } from "@/lib/help/config";

// The signed-out help form: what gets stored, and every way a request is
// stopped before it is.

const rateLimit = vi.fn();
const verifyCaptcha = vi.fn();
const getUserIdFromHeader = vi.fn();
const insert = vi.fn();
const createAdminClient = vi.fn(() => ({ from: (t: string) => (expect(t).toBe("help_requests"), { insert }) }));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...a: unknown[]) => rateLimit(...a),
  clientIpKey: (h: Headers) => h.get("x-nf-client-connection-ip") ?? "unknown",
}));
vi.mock("@/lib/help/turnstile-verify", () => ({ verifyCaptcha: (...a: unknown[]) => verifyCaptcha(...a) }));
vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const { POST } = await import("./route");

const IP = "203.0.113.7";
const good = { email: "a@example.com", topic: "account", message: "I can't sign in to my account.", captchaToken: "tok" };
const post = (body: unknown) =>
  POST(
    new Request("https://tradinglenz.netlify.app/api/help", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nf-client-connection-ip": IP },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
  verifyCaptcha.mockResolvedValue({ ok: true });
  getUserIdFromHeader.mockResolvedValue(null);
  insert.mockResolvedValue({ error: null });
});

describe("POST /api/help", () => {
  it("stores a request from someone signed out, with no account", async () => {
    const res = await post({ ...good, page: "/sign-in" });
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith({
      user_id: null,
      email: "a@example.com",
      name: null,
      topic: "account",
      message: good.message,
      page: "/sign-in",
    });
  });

  it("takes the account only from the verified session, never the body", async () => {
    getUserIdFromHeader.mockResolvedValue("user-1");
    await post({ ...good, user_id: "someone-else" });
    expect(insert.mock.calls[0][0].user_id).toBe("user-1");
  });

  it("checks the robot box for everyone, for this form and site", async () => {
    getUserIdFromHeader.mockResolvedValue("user-1");
    await post(good);
    expect(verifyCaptcha).toHaveBeenCalledWith("tok", { ip: IP, action: "help", hostname: "tradinglenz.netlify.app" });
  });

  it("stores nothing when the robot check fails", async () => {
    verifyCaptcha.mockResolvedValue({ ok: false, reason: "failed" });
    const res = await post(good);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/security check/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses (503) rather than run unchecked when the check isn't configured", async () => {
    verifyCaptcha.mockResolvedValue({ ok: false, reason: "not_configured" });
    const res = await post(good);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/TradingLenzSupport@proton\.me/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("answers a bot that fills the honeypot with 'sent', and stores nothing", async () => {
    const res = await post({ ...good, [HONEYPOT_FIELD]: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(insert).not.toHaveBeenCalled();
    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  it("refuses an invalid request before any limit or check", async () => {
    const res = await post({ ...good, message: "hi" });
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("limits per IP, per address (hashed), per account, and for the whole site", async () => {
    getUserIdFromHeader.mockResolvedValue("user-1");
    await post({ ...good, email: "Someone@Example.com" });
    const calls = rateLimit.mock.calls.map((c) => [c[0], c[1]]);
    expect(calls[0]).toEqual([`help:ip:${IP}`, HELP_LIMITS.perIpPerHour]);
    expect(calls[1][0]).toMatch(/^help:email:[0-9a-f]{32}$/);
    expect(calls[2]).toEqual(["help:user:user-1", HELP_LIMITS.perAccountPerDay]);
    expect(calls[3]).toEqual(["help:site", HELP_LIMITS.sitePerDay]);
    expect(calls.map((c) => c[0]).join()).not.toMatch(/someone|example/i);
  });

  it.each(["help:ip:", "help:email:", "help:user:"])("stops at the %s limit with a 429, before the robot check and the insert", async (prefix) => {
    getUserIdFromHeader.mockResolvedValue("user-1");
    rateLimit.mockImplementation(async (key: string) => ({ ok: !key.startsWith(prefix), retryAfterSeconds: 60 }));
    const res = await post(good);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(verifyCaptcha).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("stops at the site-wide daily ceiling", async () => {
    rateLimit.mockImplementation(async (key: string) => ({ ok: key !== "help:site", retryAfterSeconds: 3600 }));
    const res = await post(good);
    expect(res.status).toBe(429);
    expect(insert).not.toHaveBeenCalled();
  });

  it("says the form is unavailable when the table isn't there or is full, without detail", async () => {
    insert.mockResolvedValue({ error: { code: "PGRST205", message: "no table help_requests" } });
    let res = await post(good);
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/PGRST|help_requests/);
    insert.mockResolvedValue({ error: { code: "54000", message: "Row limit reached" } });
    res = await post(good);
    expect(res.status).toBe(503);
  });
});
