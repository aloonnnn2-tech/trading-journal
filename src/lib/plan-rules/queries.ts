import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/supabase/errors";
import type { StrategyRule } from "./types";

// Reads and writes for `strategy_rules` (0033), all through the RLS-scoped
// client -- "strategy_rules owner access" already confines every statement to
// the signed-in user's own rows.

const COLUMNS =
  "id, strategy_id, label, subject_source, subject_key, operator, number_value, number_value_max, text_value, enabled, sort_order";

export interface RuleInput {
  label: string;
  subject_source: StrategyRule["subject_source"];
  subject_key: string;
  operator: StrategyRule["operator"];
  number_value: number | null;
  number_value_max: number | null;
  text_value: string | null;
  enabled?: boolean;
  sort_order?: number;
}

/**
 * Rules for one strategy.
 *
 * Returns an empty list rather than throwing when 0033 hasn't been applied:
 * the trade page and the strategies page both render this alongside everything
 * else, and a pending migration must degrade to "no rules yet" rather than
 * taking the page down. The write routes report the missing table properly,
 * which is where a user can act on it.
 */
export async function listRulesForStrategy(
  supabase: SupabaseClient,
  strategyId: string,
): Promise<StrategyRule[]> {
  const { data, error } = await supabase
    .from("strategy_rules")
    .select(COLUMNS)
    .eq("strategy_id", strategyId)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as StrategyRule[];
}

/**
 * Rules for several strategies at once, grouped by strategy id.
 *
 * One query rather than one per strategy: a trade can carry several
 * strategies, and the trade page would otherwise issue a round trip for each.
 */
export async function listRulesForStrategies(
  supabase: SupabaseClient,
  strategyIds: string[],
): Promise<Record<string, StrategyRule[]>> {
  if (strategyIds.length === 0) return {};

  const { data, error } = await supabase
    .from("strategy_rules")
    .select(COLUMNS)
    .in("strategy_id", strategyIds)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return {};
    throw error;
  }

  const grouped: Record<string, StrategyRule[]> = {};
  for (const rule of (data ?? []) as unknown as StrategyRule[]) {
    (grouped[rule.strategy_id] ??= []).push(rule);
  }
  return grouped;
}

export async function createRule(
  supabase: SupabaseClient,
  userId: string,
  strategyId: string,
  input: RuleInput,
): Promise<StrategyRule> {
  const { data, error } = await supabase
    .from("strategy_rules")
    .insert({ user_id: userId, strategy_id: strategyId, ...input })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as StrategyRule;
}

/**
 * Replaces a rule's definition. Returns null when nothing matched.
 *
 * `strategy_id` and `user_id` are never written here: RLS scopes the update to
 * the caller's rows, and not accepting a strategy id means a PATCH can't
 * quietly move a rule onto a different strategy.
 */
export async function updateRule(
  supabase: SupabaseClient,
  id: string,
  input: RuleInput,
): Promise<StrategyRule | null> {
  const { data, error } = await supabase
    .from("strategy_rules")
    .update(input)
    .eq("id", id)
    .select(COLUMNS);

  if (error) throw error;
  return (data?.[0] as unknown as StrategyRule) ?? null;
}

/**
 * Deletes a rule. Returns false when nothing matched, which the route turns
 * into a 404 rather than a 403 -- the same non-enumerable posture as the key
 * and review routes.
 */
export async function deleteRule(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("strategy_rules")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
