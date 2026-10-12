import { beforeEach, describe, expect, it, vi } from "vitest";

// N-3 (2026-10-12): the counter is reached only through this route, which
// limits per IP and calls the database as the service role.
const rpc = vi.fn();
const createAdminClient = vi.fn(() => ({ rpc }));
const enforceRateLimit = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
  clientIpKey: (h: Headers) => h.get("x-nf-client-connection-ip") ?? "unknown",
}));

import { POST } from "./route";

const post = (body: unknown, ip = "203.0.113.7") =>
  POST(
    new Request("http://localhost/api/analytics/public-view", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nf-client-connection-ip": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  createAdminClient.mockClear();
  enforceRateLimit.mockReset().mockResolvedValue(null);
});

describe("POST /api/analytics/public-view", () => {
  it("counts a tracked page through the service-role client", async () => {
    const res = await post({ path: "/" });
    expect(res.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("record_public_view", { p_path: "/" });
  });

  it("limits per IP, 60 views an hour, keyed by the client address only", async () => {
    await post({ path: "/privacy" }, "198.51.100.4");
    expect(enforceRateLimit).toHaveBeenCalledWith("public-view:198.51.100.4", 60, 60 * 60 * 1000);
  });

  it("over the limit: refused and nothing counted", async () => {
    enforceRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const res = await post({ path: "/" });
    expect(res.status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an untracked path or a bad body is a 400 and nothing is counted", async () => {
    expect((await post({ path: "/admin" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a database failure is answered quietly (it's a beacon)", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "permission denied" } });
    expect((await post({ path: "/" })).status).toBe(204);
    createAdminClient.mockImplementationOnce(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    });
    expect((await post({ path: "/" })).status).toBe(204);
  });
});
