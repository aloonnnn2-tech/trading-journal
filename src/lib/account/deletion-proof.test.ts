import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDeletionProof, deletionProof, hashDeletionToken, isDeletionTokenShape, newDeletionToken } from "./deletion-proof";

const T0 = Date.parse("2026-10-20T10:00:00Z");
const { token, hash } = newDeletionToken();
const request = {
  requested_at: new Date(T0).toISOString(),
  expires_at: new Date(T0 + 3_600_000).toISOString(),
  token_hash: hash,
};

describe("newDeletionToken", () => {
  it("makes a fresh 32-byte code each time, kept only as its SHA-256", () => {
    const a = newDeletionToken();
    const b = newDeletionToken();
    expect(a.token).not.toBe(b.token);
    expect(isDeletionTokenShape(a.token)).toBe(true);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashDeletionToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });

  it("has no '.' or '/', so Supabase's Redirect URL '*' matches it", () => {
    for (let i = 0; i < 50; i++) expect(newDeletionToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("checkDeletionProof", () => {
  it("passes for the code from the newest email, within the hour", () => {
    expect(checkDeletionProof(request, token, T0 + 120_000)).toEqual({ ok: true });
  });

  it("refuses without a request, or a request from before codes existed", () => {
    expect(checkDeletionProof(null, token, T0)).toEqual({ ok: false, reason: "no_request" });
    expect(checkDeletionProof({ ...request, token_hash: null }, token, T0)).toEqual({ ok: false, reason: "no_request" });
  });

  it("refuses once the hour is up, even with the right code", () => {
    expect(checkDeletionProof(request, token, T0 + 3_600_001)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a code from an older email, or any other code", () => {
    expect(checkDeletionProof(request, newDeletionToken().token, T0 + 1_000)).toEqual({ ok: false, reason: "wrong_link" });
  });

  it("refuses anything that isn't a code", () => {
    for (const bad of [undefined, null, "", "x".repeat(42), `${token}.`, `${token.slice(0, 42)}/`, 42, { token }]) {
      expect(checkDeletionProof(request, bad, T0 + 1_000), String(bad)).toEqual({ ok: false, reason: "wrong_link" });
    }
  });

  it("refuses a malformed request row", () => {
    expect(checkDeletionProof({ ...request, expires_at: "nope" }, token, T0).ok).toBe(false);
  });
});

describe("deletionProof", () => {
  const admin = (row: unknown, error: unknown = null) => {
    const eq: string[] = [];
    const client = {
      from: (t: string) => {
        expect(t).toBe("account_deletion_requests");
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              eq.push(`${col}=${val}`);
              return { maybeSingle: async () => ({ data: row, error }) };
            },
          }),
        };
      },
    } as unknown as SupabaseClient;
    return { client, eq };
  };

  it("reads the request by the signed-in account's id, never by the code", async () => {
    const now = Date.now();
    const { client, eq } = admin({ ...request, expires_at: new Date(now + 60_000).toISOString() });
    expect(await deletionProof(client, "user-1", token)).toEqual({ ok: true });
    expect(eq).toEqual(["user_id=user-1"]);
  });

  it("is 'unavailable' when the request can't be read, never ok", async () => {
    expect(await deletionProof(admin(null, { code: "XX" }).client, "u1", token)).toEqual({ ok: false, reason: "unavailable" });
  });
});
