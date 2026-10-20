import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDeletionProof, deletionProof, emailLinkSignIns } from "./deletion-proof";

const T0 = Date.parse("2026-10-20T10:00:00Z");
const request = { requested_at: new Date(T0).toISOString(), expires_at: new Date(T0 + 3_600_000).toISOString() };
const otpAt = (ms: number) => [{ method: "otp", timestamp: Math.floor(ms / 1000) }];

describe("checkDeletionProof", () => {
  it("passes for a sign-in from the emailed link after the request, before it expires", () => {
    expect(checkDeletionProof(request, otpAt(T0 + 120_000), T0 + 130_000)).toEqual({ ok: true });
  });

  it("refuses without a request", () => {
    expect(checkDeletionProof(null, otpAt(T0), T0)).toEqual({ ok: false, reason: "no_request" });
  });

  it("refuses once the request has expired, even with a valid link sign-in", () => {
    expect(checkDeletionProof(request, otpAt(T0 + 60_000), T0 + 3_600_001)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a password or Google session: it never touched the inbox", () => {
    expect(checkDeletionProof(request, [{ method: "password", timestamp: (T0 + 60_000) / 1000 }], T0 + 70_000)).toEqual({
      ok: false,
      reason: "needs_link",
    });
    expect(checkDeletionProof(request, [{ method: "oauth", timestamp: (T0 + 60_000) / 1000 }], T0 + 70_000).ok).toBe(false);
  });

  it("refuses an email-link sign-in from BEFORE the request (an old session, not this email)", () => {
    expect(checkDeletionProof(request, otpAt(T0 - 60_000), T0 + 1_000)).toEqual({ ok: false, reason: "needs_link" });
    // Even seconds before: only rounding to the whole second is forgiven.
    expect(checkDeletionProof(request, otpAt(T0 - 3_000), T0 + 1_000)).toEqual({ ok: false, reason: "needs_link" });
    expect(checkDeletionProof(request, otpAt(T0), T0 + 1_000)).toEqual({ ok: true });
  });

  it("refuses a claim from the future (forged or broken clock)", () => {
    expect(checkDeletionProof(request, otpAt(T0 + 600_000), T0 + 1_000).ok).toBe(false);
  });

  it("refuses malformed requests and claims", () => {
    expect(checkDeletionProof({ requested_at: "nope", expires_at: "nope" }, otpAt(T0), T0).ok).toBe(false);
    expect(checkDeletionProof(request, "otp", T0 + 1_000).ok).toBe(false);
    expect(checkDeletionProof(request, [{ method: "otp" }], T0 + 1_000).ok).toBe(false);
    expect(checkDeletionProof(request, null, T0 + 1_000).ok).toBe(false);
  });
});

describe("emailLinkSignIns", () => {
  it("keeps only emailed-link methods, in ms", () => {
    expect(emailLinkSignIns([{ method: "password", timestamp: 1 }, { method: "otp", timestamp: 2 }, { method: "magiclink", timestamp: 3 }])).toEqual([2000, 3000]);
  });
});

describe("deletionProof", () => {
  const admin = (row: unknown, error: unknown = null) =>
    ({
      from: (t: string) => {
        expect(t).toBe("account_deletion_requests");
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) };
      },
    }) as unknown as SupabaseClient;
  const user = (claims: unknown, error: unknown = null) =>
    ({ auth: { getClaims: async () => ({ data: claims ? { claims } : null, error }) } }) as unknown as SupabaseClient;

  it("uses the verified claims of THIS account only", async () => {
    const now = Date.now();
    const row = { requested_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 60_000).toISOString() };
    expect(await deletionProof(user({ sub: "u1", amr: otpAt(now - 1_000) }), admin(row), "u1")).toEqual({ ok: true });
    expect(await deletionProof(user({ sub: "someone-else", amr: otpAt(now - 1_000) }), admin(row), "u1")).toEqual({
      ok: false,
      reason: "needs_link",
    });
    expect(await deletionProof(user(null, { message: "bad token" }), admin(row), "u1")).toEqual({ ok: false, reason: "needs_link" });
  });

  it("is 'unavailable' when the request can't be read, never ok", async () => {
    expect(await deletionProof(user({ sub: "u1", amr: otpAt(Date.now()) }), admin(null, { code: "XX" }), "u1")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
