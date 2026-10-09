/**
 * Existing-account consent (Part B): an account with no recorded agreement
 * needs it, POST /api/account/consent records it with the server's clock,
 * and the user still cannot write those columns directly. DEV project only;
 * skipped (with the reason) until migration 0061 is applied there.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createWorld, destroyWorld, type TestUser } from "./world";
import { needsConsent } from "@/lib/legal/consent";
import { TERMS_VERSION } from "@/lib/legal/terms";

const acting = vi.hoisted(() => ({ userId: "", token: "" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(acting.userId ? { "x-user-id": acting.userId } : {}),
  cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => {} }),
}));

let A: TestUser;
let B: TestUser;
let has0061 = false;

beforeAll(async () => {
  const probe = await admin().from("user_settings").select("age_confirmed_at").limit(1);
  has0061 = !probe.error;
  if (!has0061) return;
  ({ A, B } = await createWorld());
});
afterAll(async () => {
  await destroyWorld(A, B);
});

async function post(body: unknown) {
  const { POST } = await import("@/app/api/account/consent/route");
  return POST(
    new Request("http://localhost/api/account/consent", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("existing-account consent", () => {
  it("records agreement once, server-side, for the caller only", async (ctx) => {
    if (!has0061) ctx.skip("migration 0061 is not applied on the dev project yet");
    acting.userId = A.id;
    acting.token = A.accessToken;

    // Created by the admin API with no sign-up flags: like a pre-checkbox account.
    expect(await needsConsent(A.db, A.id)).toBe(true);

    expect((await post({ age_confirmed: false, accepted_terms_version: TERMS_VERSION })).status).toBe(400);
    expect((await post({ age_confirmed: true, accepted_terms_version: "1999-01-01" })).status).toBe(400);
    expect((await post({ age_confirmed: true, accepted_terms_version: TERMS_VERSION, user_id: B.id })).status).toBe(400);

    expect((await post({ age_confirmed: true, accepted_terms_version: TERMS_VERSION })).status).toBe(200);
    expect(await needsConsent(A.db, A.id)).toBe(false);
    // B untouched.
    expect(await needsConsent(B.db, B.id)).toBe(true);
  });

  it("the user cannot write or clear the consent columns directly", async (ctx) => {
    if (!has0061) ctx.skip("migration 0061 is not applied on the dev project yet");
    const set = await B.db.from("user_settings").update({ terms_accepted_at: new Date().toISOString() }).eq("user_id", B.id);
    expect(set.error?.code).toBe("42501");
    const clear = await A.db.from("user_settings").update({ age_confirmed_at: null }).eq("user_id", A.id);
    expect(clear.error?.code).toBe("42501");
  });

  it("401 without a session", async () => {
    acting.userId = "";
    expect((await post({ age_confirmed: true, accepted_terms_version: TERMS_VERSION })).status).toBe(401);
  });
});
