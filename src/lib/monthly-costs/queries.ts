import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/supabase/errors";
import { MONTHLY_COST_NOTE_PREFIX, costInAccountCurrency, dueMonths, monthLabel, type MonthlyCost } from "./due";

// Monthly costs (migration 0057). Reads and writes go through the RLS-scoped
// client, so every statement is confined to the signed-in user.

export interface MonthlyCostInput {
  name: string;
  amount: number;
  currency: string | null;
  fx_rate: number | null;
  day_of_month: number;
  starts_on: string;
  active: boolean;
}

/** Null while 0057 isn't applied: the page then says the feature is coming. */
export async function listMonthlyCosts(supabase: SupabaseClient): Promise<MonthlyCost[] | null> {
  const { data, error } = await supabase.from("monthly_costs").select("*").order("created_at", { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data ?? []) as MonthlyCost[];
}

export async function countPostings(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("monthly_cost_postings").select("cost_id");
  if (error) return {};
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[(r as { cost_id: string }).cost_id] = (out[(r as { cost_id: string }).cost_id] ?? 0) + 1;
  return out;
}

export async function createMonthlyCost(supabase: SupabaseClient, userId: string, input: MonthlyCostInput): Promise<MonthlyCost> {
  const { data, error } = await supabase.from("monthly_costs").insert({ ...input, user_id: userId }).select().single();
  if (error) throw error;
  return data as MonthlyCost;
}

export async function updateMonthlyCost(
  supabase: SupabaseClient,
  id: string,
  changes: Partial<MonthlyCostInput>,
  today = new Date(),
): Promise<MonthlyCost | null> {
  // Resuming a paused cost starts it again from today. Otherwise every month
  // it sat paused would come due at once on the next page load (dueMonths
  // counts from starts_on), charging the very months it was paused for.
  if (changes.active === true && changes.starts_on === undefined) {
    const { data: current } = await supabase.from("monthly_costs").select("active").eq("id", id).maybeSingle();
    if (current && !(current as { active: boolean }).active) {
      changes = { ...changes, starts_on: today.toISOString().slice(0, 10) };
    }
  }
  const { data, error } = await supabase.from("monthly_costs").update(changes).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data as MonthlyCost | null;
}

export async function deleteMonthlyCost(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("monthly_costs").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Takes every monthly cost that has come due and hasn't been taken yet, as a
 * withdrawal from the user's cash. Called when a page that shows cash loads,
 * so the balance is right the moment it is looked at.
 *
 * Idempotent: the (cost, month) primary key is claimed BEFORE the withdrawal
 * is written, so two loads racing on the same month cannot both take it. If
 * the withdrawal then fails, the claim is released for the next load.
 *
 * Never throws: a pending migration or a failed write must not break the
 * page it runs on. Returns how many withdrawals it made.
 */
export async function takeDueMonthlyCosts(supabase: SupabaseClient, userId: string, today = new Date()): Promise<number> {
  try {
    const costs = await listMonthlyCosts(supabase);
    if (!costs || costs.length === 0) return 0;
    const day = today.toISOString().slice(0, 10);

    const { data: taken, error } = await supabase.from("monthly_cost_postings").select("cost_id, month");
    if (error) return 0;
    const done = new Set((taken ?? []).map((t) => `${(t as { cost_id: string }).cost_id}:${(t as { month: string }).month}`));

    let made = 0;
    for (const cost of costs) {
      for (const month of dueMonths(cost, day)) {
        if (done.has(`${cost.id}:${month}`)) continue;
        const claim = await supabase.from("monthly_cost_postings").insert({ cost_id: cost.id, user_id: userId, month });
        if (claim.error) continue; // already taken by a concurrent load, or a real error: skip either way
        const dueDate = `${month.slice(0, 8)}${String(cost.day_of_month).padStart(2, "0")}`;
        const { data: tx, error: txError } = await supabase
          .from("account_transactions")
          .insert({
            user_id: userId,
            amount: -costInAccountCurrency(cost),
            note: `${MONTHLY_COST_NOTE_PREFIX}${cost.name} (${monthLabel(month)})`,
            created_at: `${dueDate}T12:00:00Z`,
          })
          .select("id")
          .single();
        if (txError || !tx) {
          await supabase.from("monthly_cost_postings").delete().eq("cost_id", cost.id).eq("month", month);
          continue;
        }
        await supabase.from("monthly_cost_postings").update({ transaction_id: tx.id }).eq("cost_id", cost.id).eq("month", month);
        made += 1;
      }
    }
    return made;
  } catch {
    return 0;
  }
}
