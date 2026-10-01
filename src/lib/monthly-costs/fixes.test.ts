import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthlyCostPatchSchema } from "./schema";
import { MONTHLY_COST_NOTE_PREFIX, isMonthlyCostNote } from "./due";
import { updateMonthlyCost } from "./queries";

describe("monthly cost edits keep currency and rate together", () => {
  it("rejects a foreign currency without its rate", () => {
    expect(monthlyCostPatchSchema.safeParse({ currency: "EUR" }).success).toBe(false);
    expect(monthlyCostPatchSchema.safeParse({ currency: "EUR", fx_rate: null }).success).toBe(false);
  });

  it("rejects clearing the rate while a currency may still be set", () => {
    expect(monthlyCostPatchSchema.safeParse({ fx_rate: null }).success).toBe(false);
  });

  it("accepts the pair, back to the account currency, and unrelated changes", () => {
    expect(monthlyCostPatchSchema.safeParse({ currency: "EUR", fx_rate: 1.1 }).success).toBe(true);
    expect(monthlyCostPatchSchema.safeParse({ currency: null, fx_rate: null }).success).toBe(true);
    expect(monthlyCostPatchSchema.safeParse({ active: false }).success).toBe(true);
  });
});

describe("monthly cost withdrawals are recognisable", () => {
  it("matches only notes the cost wrote", () => {
    expect(isMonthlyCostNote(`${MONTHLY_COST_NOTE_PREFIX}Data feed (Sep 2026)`)).toBe(true);
    expect(isMonthlyCostNote("Deposit")).toBe(false);
    expect(isMonthlyCostNote(null)).toBe(false);
  });
});

// A stand-in for the two calls updateMonthlyCost makes: read `active`, then
// update. Records what the update was given.
function fakeClient(currentlyActive: boolean, startsOn = "2026-01-01") {
  const sent: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { active: currentlyActive, starts_on: startsOn }, error: null }) }) }),
      update: (changes: Record<string, unknown>) => {
        sent.push(changes);
        return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: changes, error: null }) }) }) };
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, sent };
}

describe("resuming a paused cost", () => {
  const today = new Date("2026-09-30T10:00:00Z");

  it("starts it again from today, so the paused months aren't charged", async () => {
    const { client, sent } = fakeClient(false);
    await updateMonthlyCost(client, "id", { active: true }, today);
    expect(sent[0]).toEqual({ active: true, starts_on: "2026-09-30" });
  });

  it("keeps a later scheduled start", async () => {
    const { client, sent } = fakeClient(false, "2026-12-01");
    await updateMonthlyCost(client, "id", { active: true }, today);
    expect(sent[0]).toEqual({ active: true });
  });

  it("leaves the start alone when the cost was already running", async () => {
    const { client, sent } = fakeClient(true);
    await updateMonthlyCost(client, "id", { active: true }, today);
    expect(sent[0]).toEqual({ active: true });
  });
});
