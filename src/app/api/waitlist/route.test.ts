import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const from = vi.fn(() => ({ insert }));
const enforceRateLimit = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
  clientIpKey: () => "203.0.113.7",
}));

const { POST } = await import("./route");

function post(body: unknown, raw = false): Request {
  return new Request("https://tradinglenz.netlify.app/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const good = { email: "trader@example.com", source: "home-paid-card", website: "" };

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue(null);
  insert.mockResolvedValue({ error: null });
});

describe("POST /api/waitlist", () => {
  it("stores a valid signup and answers ok", async () => {
    const res = await POST(post(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("waitlist");
    expect(insert).toHaveBeenCalledWith({ email: "trader@example.com", source: "home-paid-card" });
  });

  it("answers a duplicate exactly like a new signup, so the list can't be probed", async () => {
    insert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });
    const res = await POST(post(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers a filled honeypot with the same ok and never touches the database", async () => {
    const res = await POST(post({ ...good, website: "https://spam.example" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a malformed address without storing it", async () => {
    const res = await POST(post({ ...good, email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid email" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an address over 254 characters", async () => {
    const res = await POST(post({ ...good, email: "a".repeat(250) + "@x.co" }));
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a body that isn't JSON", async () => {
    const res = await POST(post("{not json", true));
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("passes the limiter's 429 through and stores nothing", async () => {
    enforceRateLimit.mockResolvedValue(Response.json({ error: "slow down" }, { status: 429 }));
    const res = await POST(post(good));
    expect(res.status).toBe(429);
    expect(insert).not.toHaveBeenCalled();
  });

  it("doesn't spend the limit on typos or honeypot hits", async () => {
    await POST(post({ ...good, email: "not-an-email" }));
    await POST(post({ ...good, website: "x" }));
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("limits per IP, five an hour", async () => {
    await POST(post(good));
    expect(enforceRateLimit).toHaveBeenCalledWith("waitlist:203.0.113.7", 5, 3_600_000, expect.any(String));
  });

  it("answers 503 when the table doesn't exist yet (migration 0050 unapplied)", async () => {
    // PGRST205 is what the live project actually returned before 0050 existed;
    // 42P01 is Postgres's own code for the same thing.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const code of ["PGRST205", "42P01"]) {
      insert.mockResolvedValue({ error: { code, message: "no waitlist table" } });
      const res = await POST(post(good));
      expect(res.status).toBe(503);
    }
    quiet.mockRestore();
  });

  it("answers 500 on any other database error", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    insert.mockResolvedValue({ error: { code: "08006", message: "connection failure" } });
    const res = await POST(post(good));
    expect(res.status).toBe(500);
    quiet.mockRestore();
  });
});
