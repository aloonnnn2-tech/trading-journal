import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/supabase/errors";
import { buildMistakeTrades } from "@/lib/mistakes/queries";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { Trade } from "@/lib/trades/types";
import { evaluateGoal, type Goal, type GoalProgress, type GoalTrade } from "./evaluate";

const COLUMNS =
  "id, label, kind, subject_source, subject_key, operator, number_value, number_value_max, text_value, metric, mistake_label, target, target_direction, period, active, sort_order";

export async function listGoals(supabase: SupabaseClient): Promise<Goal[]> {
  const { data, error } = await supabase.from("goals").select(COLUMNS).order("sort_order");

  if (error) {
    // A pending migration degrades to "no goals yet" rather than a broken
    // page; the write routes report the missing table properly.
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as Goal[];
}

export type GoalInput = Omit<Goal, "id">;

export async function createGoal(
  supabase: SupabaseClient,
  userId: string,
  input: GoalInput,
): Promise<Goal> {
  const { data, error } = await supabase
    .from("goals")
    .insert({ user_id: userId, ...input })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as Goal;
}

export async function updateGoal(
  supabase: SupabaseClient,
  id: string,
  input: GoalInput,
): Promise<Goal | null> {
  const { data, error } = await supabase.from("goals").update(input).eq("id", id).select(COLUMNS);
  if (error) throw error;
  return (data?.[0] as unknown as Goal) ?? null;
}

/** RLS scopes the delete, so someone else's id matches nothing -- reported as
 *  404 rather than 403, the same non-enumerable posture as everywhere else. */
export async function deleteGoal(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("goals").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Every goal with its current progress.
 *
 * The mistake labels come from `buildMistakeTrades`, the same assembly the
 * mistake tracker uses -- so a "reduce moved stops" goal and the tracker can
 * never disagree about what a moved stop is. It is only fetched when a
 * reduction goal exists, since it reads the whole edit history and there is no
 * reason to pay for that otherwise.
 */
export async function getGoalProgress(
  supabase: SupabaseClient,
  timezone: string | null,
): Promise<GoalProgress[]> {
  const goals = (await listGoals(supabase)).filter((g) => g.active);
  if (goals.length === 0) return [];

  const needsMistakes = goals.some((g) => g.kind === "reduction");

  const [rows, mistakeTrades] = await Promise.all([
    fetchAllRows<Trade>((from, to) =>
      supabase
        .from("trades")
        .select("*")
        .eq("status", "closed")
        .not("exit_date", "is", null)
        .neq("mode", "investment")
        .order("exit_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    needsMistakes ? buildMistakeTrades(supabase).catch(() => []) : Promise.resolve([]),
  ]);

  const mistakesByTrade = new Map(
    mistakeTrades.map((t) => [t.id, t.mistakes.map((m) => m.label)]),
  );

  const trades: GoalTrade[] = rows.map((row) => ({
    id: row.id,
    exit_date: row.exit_date ?? "",
    dollar_pl: row.dollar_pl,
    r_multiple: row.r_multiple,
    mistakes: mistakesByTrade.get(row.id) ?? [],
    trade: row,
  }));

  return goals.map((goal) => evaluateGoal(goal, trades, timezone));
}
