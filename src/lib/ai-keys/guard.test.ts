import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate every AI route depends on. It had no tests, which for the one
// function standing between a free account and a paid feature is the wrong
// place to have a coverage gap -- a regression here doesn't crash anything,
// it just quietly gives the feature away (or, in the other direction, locks
// paying users out).

const headerStore = { userId: null as string | null };
const settingsStore = { plan: "free" as string, throws: false };

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => (name === "x-user-id" ? headerStore.userId : null) }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __marker: "rls-scoped-client" }),
}));

vi.mock("@/lib/settings/queries", () => ({
  getUserSettings: async () => {
    if (settingsStore.throws) throw new Error("db down");
    return { plan: settingsStore.plan, hidden_core_fields: [], timezone: null };
  },
}));

const { requirePaidUser, UPGRADE_MESSAGE } = await import("./guard");

beforeEach(() => {
  headerStore.userId = "user-1";
  settingsStore.plan = "free";
  settingsStore.throws = false;
});

async function bodyOf(response: Response): Promise<{ error?: string }> {
  return (await response.json()) as { error?: string };
}

describe("requirePaidUser", () => {
  it("refuses an unauthenticated caller with 401", async () => {
    headerStore.userId = null;
    const gate = await requirePaidUser();

    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    expect(gate.response.status).toBe(401);
  });

  it("says nothing about plans to an unauthenticated caller", async () => {
    // 401 must come before 403: someone who isn't signed in shouldn't learn
    // anything about what plans exist or what this account has.
    headerStore.userId = null;
    settingsStore.plan = "paid";
    const gate = await requirePaidUser();

    if (gate.ok) throw new Error("unreachable");
    const body = await bodyOf(gate.response);
    expect(body.error).toBe("Unauthorized");
    expect(body.error).not.toMatch(/plan|upgrade/i);
  });

  it("refuses a signed-in free user with 403 and an actionable message", async () => {
    settingsStore.plan = "free";
    const gate = await requirePaidUser();

    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    expect(gate.response.status).toBe(403);
    expect((await bodyOf(gate.response)).error).toBe(UPGRADE_MESSAGE);
  });

  it("admits a paid user and hands back the RLS-scoped client", async () => {
    settingsStore.plan = "paid";
    const gate = await requirePaidUser();

    expect(gate.ok).toBe(true);
    if (!gate.ok) throw new Error("unreachable");
    expect(gate.userId).toBe("user-1");
    // Routes must use this client rather than building their own -- it is what
    // confines every subsequent key and trade query to this user's rows.
    expect((gate.supabase as unknown as { __marker: string }).__marker).toBe("rls-scoped-client");
  });

  it("fails closed on an unrecognized plan value", async () => {
    // Anything that isn't exactly "paid" must deny. A hand-edited row or a
    // future tier added to the database before this code knows about it must
    // not accidentally unlock the feature.
    for (const plan of ["Paid", "PAID", "premium", "trial", "", "free "]) {
      settingsStore.plan = plan;
      const gate = await requirePaidUser();
      expect(gate.ok, `plan=${JSON.stringify(plan)} should be denied`).toBe(false);
    }
  });

  it("does not swallow a database failure into an access grant", async () => {
    // If settings can't be read we must not proceed as though the user were
    // paid. Throwing surfaces as a 500, which is correct -- silently allowing
    // would be a security bug, silently denying would hide an outage.
    settingsStore.throws = true;
    await expect(requirePaidUser()).rejects.toThrow("db down");
  });
});
