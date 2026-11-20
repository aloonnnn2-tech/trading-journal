import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runOnboardingEmails } from "./run-onboarding";
import type { OutgoingMail } from "./gmail";

const NOW = new Date("2026-11-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

interface FakeUser {
  id: string;
  email: string;
  created_at: string;
  email_confirmed_at: string | null;
  app_metadata: Record<string, unknown>;
}

function fakeAdmin(users: FakeUser[], opts: { trades?: Record<string, number>; excluded?: string[] } = {}) {
  const updates: { id: string; app_metadata: Record<string, unknown> }[] = [];
  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      limit: () => q,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return q;
      },
      then: (resolve: (v: unknown) => void) => {
        if (table === "user_settings") {
          resolve({ data: (opts.excluded ?? []).map((user_id) => ({ user_id })), error: null });
        } else {
          const uid = filters.user_id as string | undefined;
          resolve({ count: uid ? (opts.trades?.[uid] ?? 0) : 0, error: null });
        }
      },
    };
    return q;
  };
  const admin = {
    from: query,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users }, error: null }),
        updateUserById: async (id: string, attrs: { app_metadata: Record<string, unknown> }) => {
          updates.push({ id, app_metadata: attrs.app_metadata });
          return { data: {}, error: null };
        },
      },
    },
  };
  return { admin: admin as unknown as SupabaseClient, updates };
}

const user = (id: string, over: Partial<FakeUser> = {}): FakeUser => ({
  id,
  email: `${id}@gmail.com`,
  created_at: hoursAgo(2),
  email_confirmed_at: hoursAgo(2),
  app_metadata: { provider: "email" },
  ...over,
});

describe("runOnboardingEmails", () => {
  it("welcomes new accounts, skips old, excluded and test ones, and records the send", async () => {
    const { admin, updates } = fakeAdmin(
      [
        user("new1"),
        user("old1", { created_at: hoursAgo(24 * 30) }),
        user("excl1"),
        user("t1", { email: "someone@x.test" }),
      ],
      { excluded: ["excl1"] },
    );
    const sent: OutgoingMail[] = [];
    const res = await runOnboardingEmails({
      admin,
      send: async (m) => void sent.push(m),
      secret: "s",
      now: NOW,
      dryRun: false,
    });
    expect(res.welcome).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(["new1@gmail.com"]);
    expect(sent[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(updates).toHaveLength(1);
    expect(updates[0].app_metadata).toMatchObject({
      provider: "email",
      onboarding_emails: { welcome_sent_at: NOW.toISOString() },
    });
  });

  it("nudges only accounts with no trade of their own", async () => {
    const welcomed = { onboarding_emails: { welcome_sent_at: hoursAgo(49) } };
    const { admin } = fakeAdmin(
      [
        user("empty", { created_at: hoursAgo(50), app_metadata: welcomed }),
        user("logged", { created_at: hoursAgo(50), app_metadata: welcomed }),
      ],
      { trades: { logged: 1 } },
    );
    const sent: OutgoingMail[] = [];
    const res = await runOnboardingEmails({ admin, send: async (m) => void sent.push(m), secret: "s", now: NOW, dryRun: false });
    expect(res).toMatchObject({ nudge: 1, nudgeNotNeeded: 1 });
    expect(sent.map((m) => m.to)).toEqual(["empty@gmail.com"]);
  });

  it("undoes the record when Gmail refuses, so the next run tries again", async () => {
    const { admin, updates } = fakeAdmin([user("new1")]);
    const res = await runOnboardingEmails({
      admin,
      send: vi.fn(async () => {
        throw new Error("535 bad credentials");
      }),
      secret: "s",
      now: NOW,
      dryRun: false,
    });
    expect(res.welcome).toBe(0);
    expect(res.failures[0]).toContain("535");
    expect(updates.at(-1)?.app_metadata).toMatchObject({ onboarding_emails: {} });
  });

  it("dry run sends and records nothing", async () => {
    const { admin, updates } = fakeAdmin([user("new1")]);
    const send = vi.fn();
    const res = await runOnboardingEmails({ admin, send, secret: "s", now: NOW, dryRun: true });
    expect(res.welcome).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});
