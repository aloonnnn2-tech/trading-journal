/**
 * "Download all my data" on the DEV project: the file is complete, parses,
 * holds the caller's records -- and none of anyone else's, including the
 * usage events read with the service-role client.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createWorld, destroyWorld, type TestUser } from "./world";
import { EXPORT_SECTIONS } from "@/lib/account/data-export";

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
  // One usage event each, so the service-role sections have something to leak.
  await admin()
    .from("analytics_events")
    .insert([
      { user_id: A.id, session_id: "s-a", event_name: "page_view", event_props: { path: `/a-${A.journal.marker}` } },
      { user_id: B.id, session_id: "s-b", event_name: "page_view", event_props: { path: `/b-${B.journal.marker}` } },
    ]);
});
afterAll(async () => {
  await destroyWorld(A, B);
});

describe("GET /api/account/export", () => {
  it("is a complete, parseable file of the caller's data and nobody else's", async () => {
    acting.userId = A.id;
    acting.token = A.accessToken;
    const { GET } = await import("@/app/api/account/export/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="trading-lens-data-/);

    const text = await res.text();
    const doc = JSON.parse(text) as { sections: Record<string, unknown[]>; user_id: string };
    expect(doc.user_id).toBe(A.id);
    expect(Object.keys(doc.sections)).toEqual(EXPORT_SECTIONS.map((s) => s.name));

    expect(text).toContain(A.journal.marker);
    expect(text).not.toContain(B.journal.marker);
    for (const id of Object.values(B.journal)) expect(text).not.toContain(id);

    expect(doc.sections.trades).toHaveLength(1);
    expect(doc.sections.usage_events).toHaveLength(1);
    expect(JSON.stringify(doc.sections.ai_keys)).not.toContain("encrypted_key");
    const shot = doc.sections.screenshots[0] as { download_url_valid_1h: string | null };
    expect(shot.download_url_valid_1h).toMatch(/^https:\/\//);
  });

  it("401 without a session", async () => {
    acting.userId = "";
    acting.token = "";
    const { GET } = await import("@/app/api/account/export/route");
    expect((await GET()).status).toBe(401);
  });
});
