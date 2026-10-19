import { describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAuthProfile, toAuthProfile } from "./auth-profile";

const USER = {
  id: "user-1",
  email: "t@example.com",
  email_confirmed_at: "2026-09-01T10:00:00Z",
  created_at: "2026-09-01T09:59:00Z",
  last_sign_in_at: "2026-10-18T08:00:00Z",
  app_metadata: { provider: "email", providers: ["email", "google", 7] },
  user_metadata: { secret_note: "x" },
  identities: [{ id: "google-sub-123", identity_data: { sub: "google-sub-123" } }],
  aud: "authenticated",
} as unknown as User;

describe("toAuthProfile", () => {
  it("keeps the five fields a person would expect, and nothing else", () => {
    const profile = toAuthProfile(USER);
    expect(profile).toEqual({
      email: "t@example.com",
      email_confirmed_at: "2026-09-01T10:00:00Z",
      created_at: "2026-09-01T09:59:00Z",
      last_sign_in_at: "2026-10-18T08:00:00Z",
      sign_in_methods: ["email", "google"],
    });
    expect(JSON.stringify(profile)).not.toMatch(/google-sub-123|secret_note/);
  });
});

describe("getAuthProfile", () => {
  const admin = (result: unknown) =>
    ({ auth: { admin: { getUserById: async () => result } } }) as unknown as SupabaseClient;

  it("reads the user through the service role", async () => {
    expect((await getAuthProfile(admin({ data: { user: USER }, error: null }), "user-1"))?.email).toBe("t@example.com");
  });

  it("is null without a service-role client, on an error, or when the lookup throws", async () => {
    expect(await getAuthProfile(null, "user-1")).toBeNull();
    expect(await getAuthProfile(admin({ data: { user: null }, error: { message: "x" } }), "user-1")).toBeNull();
    const throwing = { auth: { admin: { getUserById: async () => { throw new Error("down"); } } } } as unknown as SupabaseClient;
    expect(await getAuthProfile(throwing, "user-1")).toBeNull();
  });
});
