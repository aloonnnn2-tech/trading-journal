import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/supabase/errors";
import type { CommissionRule, CommissionRuleInput } from "./types";

/**
 * Thrown when a rule needs 0055's `components` column and it isn't applied
 * yet. A single-line rule never needs it -- the write is retried without the
 * new columns -- so only a genuinely multi-line rule (a broker preset with a
 * commission plus regulatory fees) reports this, and the route says a
 * migration is pending instead of a bare 500.
 */
export class ComponentsUnavailableError extends Error {
  constructor() {
    super("commission_rules.components is missing (migration 0055)");
  }
}

/** The write without 0055's columns, when that loses nothing. */
function withoutNewColumns<T extends { components?: unknown; preset_id?: unknown }>(input: T) {
  const multiLine = Array.isArray(input.components) && input.components.length > 0;
  if (multiLine) throw new ComponentsUnavailableError();
  const rest = { ...input };
  delete rest.components;
  delete rest.preset_id;
  return rest;
}

// Error codes for "table doesn't exist" -- PGRST205 is what PostgREST
// actually returns when a table is absent from its schema cache (verified
// against this project's live instance), 42P01 is raw Postgres's
// undefined_table. Until migration 0022 is applied by hand in the SQL
// editor, every commission read has to degrade to "no rules configured"
// rather than 500 the pages that call it -- same defensive pattern as
// account/queries.ts uses for the 0016 ledger table.
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
export const isMissingCommissionTable = (error: { code?: string }) =>
  MISSING_TABLE_CODES.has(error.code ?? "");

/**
 * `userId` is optional for the normal request path, where RLS already scopes
 * the result to the signed-in user. It is **required** whenever this is
 * called with a service-role client (the scheduled auto-execution job),
 * because that client bypasses RLS -- without it, a sweep would load every
 * user's rules and price one user's trade against another's commission.
 */
export async function listCommissionRules(
  supabase: SupabaseClient,
  userId?: string,
): Promise<CommissionRule[]> {
  let query = supabase.from("commission_rules").select("*");
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error && isMissingCommissionTable(error)) return [];
  if (error) throw error;
  return data as CommissionRule[];
}

export async function createCommissionRule(
  supabase: SupabaseClient,
  userId: string,
  input: CommissionRuleInput,
): Promise<CommissionRule> {
  // New rules go to the end of the match order. Scoped rules still need to be
  // dragged above a catch-all to win, which the UI explains.
  const { data: existing, error: countError } = await supabase
    .from("commission_rules")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  if (countError) throw countError;
  const nextOrder = ((existing?.[0] as { sort_order: number } | undefined)?.sort_order ?? -1) + 1;

  let { data, error } = await supabase
    .from("commission_rules")
    .insert({ user_id: userId, sort_order: nextOrder, ...input })
    .select()
    .single();
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase
      .from("commission_rules")
      .insert({ user_id: userId, sort_order: nextOrder, ...withoutNewColumns(input) })
      .select()
      .single());
  }

  if (error) throw error;
  return data as CommissionRule;
}

export async function updateCommissionRule(
  supabase: SupabaseClient,
  id: string,
  changes: Partial<CommissionRuleInput & { sort_order: number }>,
): Promise<CommissionRule | null> {
  let { data, error } = await supabase
    .from("commission_rules")
    .update(changes)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase
      .from("commission_rules")
      .update(withoutNewColumns(changes))
      .eq("id", id)
      .select()
      .maybeSingle());
  }

  if (error) throw error;
  return data as CommissionRule | null;
}

/** Returns whether a row was actually deleted, so the route can 404. */
export async function deleteCommissionRule(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("commission_rules")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
