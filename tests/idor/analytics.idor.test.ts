/**
 * POST /api/analytics/track on the DEV project: listed events are stored
 * (page_exit included), unknown or server-only names are refused, and a
 * batch keeps its good events while counting the bad ones.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createWorld, destroyWorld, type TestUser } from "./world";

const acting = vi.hoisted(() => ({ userId: "", token: "" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(acting.userId ? { "x-user-id": acting.userId } : {}),
  cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => {} }),
}));
vi.mock("@/lib/supabase/server", async () => {
  const { clientFor } = await import("./world");
  return { createClient: async () => clientFor(acting.token) };
});

let A: TestUser;
let B: TestUser;
beforeAll(async () => {
  ({ A, B } = await createWorld());
  acting.userId = A.id;
  acting.token = A.accessToken;
});
afterAll(async () => {
  await destroyWorld(A, B);
});

async function post(body: unknown) {
  const { POST } = await import("@/app/api/analytics/track/route");
  const res = await POST(
    new Request("http://localhost/api/analytics/track", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function stored(sessionId: string) {
  const { data } = await admin()
    .from("analytics_events")
    .select("event_name, event_props")
    .eq("user_id", A.id)
    .eq("session_id", sessionId);
  return data ?? [];
}

describe("POST /api/analytics/track", () => {
  it("stores a page_exit (what the browser sends when the tab is hidden)", async () => {
    const sessionId = `itest-${crypto.randomUUID()}`;
    const res = await post({ sessionId, eventName: "page_exit", props: { path: "/trades" } });
    expect(res.status).toBe(200);
    expect(await stored(sessionId)).toEqual([{ event_name: "page_exit", event_props: { path: "/trades" } }]);
  });

  it("refuses an unknown event and a server-only one, storing nothing", async () => {
    const sessionId = `itest-${crypto.randomUUID()}`;
    expect((await post({ sessionId, eventName: "made_up", props: {} })).status).toBe(400);
    expect((await post({ sessionId, eventName: "trade_created", props: { tradeId: "x" } })).status).toBe(400);
    expect((await post({ sessionId, eventName: "page_view", props: { path: "/x", typed: "secret" } })).status).toBe(400);
    expect(await stored(sessionId)).toEqual([]);
  });

  it("a batch keeps the good events and reports how many it dropped", async () => {
    const sessionId = `itest-${crypto.randomUUID()}`;
    const res = await post({
      sessionId,
      events: [
        { eventName: "click", props: { label: "nav-trades", tag: "a", path: "/dashboard" } },
        { eventName: "nope", props: {} },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.rejected).toBe(1);
    expect((await stored(sessionId)).map((r) => r.event_name)).toEqual(["click"]);
  });
});

describe("admin_activity (migration 0062)", () => {
  it("refuses a non-admin and answers an admin", async () => {
    const denied = await A.db.rpc("admin_activity", { p_days: 1 });
    expect(denied.error).not.toBeNull();

    await admin().from("user_settings").update({ is_admin: true }).eq("user_id", B.id);
    const ok = await B.db.rpc("admin_activity", { p_days: 1, p_user_id: A.id });
    expect(ok.error).toBeNull();
    const rows = ok.data as { user_id: string; event_name: string; email: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === A.id)).toBe(true);
    expect(rows.some((r) => r.event_name === "page_exit")).toBe(true);
  });
});
