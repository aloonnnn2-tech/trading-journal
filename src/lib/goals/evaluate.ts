import { localDateParts, startOfLocalDayIso } from "@/lib/dates/local-day";
import { evaluateStrategyRules } from "@/lib/plan-rules/evaluate";
import type { StrategyRule } from "@/lib/plan-rules/types";
import { summariseSegment, type SegmentableTrade } from "@/lib/segments/engine";
import type { Trade } from "@/lib/trades/types";

// Measuring a goal against what actually happened.
//
// **Every shape reuses machinery that already exists**, which is the point:
// an adherence goal is a plan rule (0033) with a target, an aggregate goal
// reads the shared segments engine, and a reduction goal counts labels the
// mistake tracker already produces. No new definition of expectancy, win rate
// or "moved stop" enters the app through this feature.
//
// Nothing is stored. Progress is recomputed from the trades on every read, so
// a goal can never disagree with the journal behind it.

export const GOAL_KINDS = ["adherence", "aggregate", "reduction"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_METRICS = [
  "trade_count",
  "win_rate",
  "expectancy",
  "avg_loss_r",
  "total_r",
] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const GOAL_PERIODS = ["month", "quarter", "year", "all_time"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export const TARGET_DIRECTIONS = ["at_least", "at_most"] as const;
export type TargetDirection = (typeof TARGET_DIRECTIONS)[number];

/** A goal as stored in `goals` (0036). */
export interface Goal {
  id: string;
  label: string;
  kind: GoalKind;
  subject_source: StrategyRule["subject_source"] | null;
  subject_key: string | null;
  operator: StrategyRule["operator"] | null;
  number_value: number | null;
  number_value_max: number | null;
  text_value: string | null;
  metric: GoalMetric | null;
  mistake_label: string | null;
  target: number;
  target_direction: TargetDirection;
  period: GoalPeriod;
  active: boolean;
  sort_order: number;
}

/** The units each metric is measured in, so the UI never renders a percentage
 *  as an R multiple or vice versa. */
export const METRIC_UNITS: Record<GoalMetric, "count" | "percent" | "r"> = {
  trade_count: "count",
  win_rate: "percent",
  expectancy: "r",
  avg_loss_r: "r",
  total_r: "r",
};

export const METRIC_LABELS: Record<GoalMetric, string> = {
  trade_count: "Trades closed",
  win_rate: "Win rate",
  expectancy: "Expectancy",
  avg_loss_r: "Average loss",
  total_r: "Total R",
};

export interface GoalProgress {
  goal: Goal;
  /** Where the trader currently stands, in the goal's own units. Null when it
   *  cannot be measured at all -- no trades in the period, or a condition that
   *  no trade carried the data to check. */
  current: number | null;
  /** Trades the figure rests on. */
  sample: number;
  /** True when `current` satisfies the target in the stated direction. Null
   *  when there is nothing to judge. */
  met: boolean | null;
  /** 0-1 for a progress bar. Null when unmeasurable. Capped at 1: a bar past
   *  full says nothing extra, and the real figure is shown beside it. */
  fraction: number | null;
  /** Why nothing could be measured, shown instead of an empty bar. */
  reason: string | null;
  periodLabel: string;
}

/** The trade shape goal evaluation needs. */
export interface GoalTrade extends SegmentableTrade {
  id: string;
  exit_date: string;
  dollar_pl: number | null;
  r_multiple: number | null;
  /** Mistake labels on this trade, from the mistake tracker. */
  mistakes: string[];
  /** The full row, for adherence conditions that read arbitrary fields. */
  trade: Trade;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The window a goal is measured over, in the trader's own days.
 *
 * Calendar periods rather than rolling ones: "20 trades this month" means the
 * month on the calendar, and a rolling 30-day window would silently drop
 * trades out the back as the month went on, making progress go backwards
 * without the trader doing anything.
 */
export function resolveGoalPeriod(
  period: GoalPeriod,
  timezone: string | null,
  now: Date = new Date(),
): { startIso: string | null; label: string } {
  if (period === "all_time") return { startIso: null, label: "All time" };

  const { year, month } = localDateParts(now, timezone);

  if (period === "year") {
    return { startIso: startOfLocalDayIso(year, 0, 1, timezone), label: String(year) };
  }
  if (period === "quarter") {
    const firstMonth = Math.floor(month / 3) * 3;
    return {
      startIso: startOfLocalDayIso(year, firstMonth, 1, timezone),
      label: `Q${Math.floor(month / 3) + 1} ${year}`,
    };
  }
  return {
    startIso: startOfLocalDayIso(year, month, 1, timezone),
    label: `${MONTHS[month]} ${year}`,
  };
}

/** Turns a goal's condition fields back into the rule shape the plan-rule
 *  evaluator already understands, so there is one implementation of "does this
 *  trade satisfy this condition". */
function asRule(goal: Goal): StrategyRule {
  return {
    id: goal.id,
    strategy_id: "",
    label: goal.label,
    subject_source: goal.subject_source!,
    subject_key: goal.subject_key!,
    operator: goal.operator!,
    number_value: goal.number_value,
    number_value_max: goal.number_value_max,
    text_value: goal.text_value,
    enabled: true,
    sort_order: 0,
  };
}

function meets(current: number, target: number, direction: TargetDirection): boolean {
  return direction === "at_least" ? current >= target : current <= target;
}

/**
 * Progress towards the target, as a fraction for the bar.
 *
 * "At most" goals invert: being at zero against a target of three is complete,
 * and being at six is zero progress. Without this a "no more than 3 moved
 * stops" goal would fill up as the trader broke it.
 */
function fractionOf(current: number, target: number, direction: TargetDirection): number {
  if (direction === "at_least") {
    if (target <= 0) return 1;
    return Math.max(0, Math.min(1, current / target));
  }
  if (current <= target) return 1;
  // Past the ceiling: how far past, bounded so one bad month doesn't render
  // as a negative bar.
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, target / current));
}

export function evaluateGoal(
  goal: Goal,
  trades: GoalTrade[],
  timezone: string | null,
  now: Date = new Date(),
): GoalProgress {
  const { startIso, label } = resolveGoalPeriod(goal.period, timezone, now);
  const inPeriod = startIso === null ? trades : trades.filter((t) => t.exit_date >= startIso);

  const empty = (reason: string): GoalProgress => ({
    goal,
    current: null,
    sample: inPeriod.length,
    met: null,
    fraction: null,
    reason,
    periodLabel: label,
  });

  if (inPeriod.length === 0) {
    return empty("No closed trades in this period yet.");
  }

  let current: number | null = null;
  let sample = inPeriod.length;

  if (goal.kind === "adherence") {
    // One implementation of "does this trade satisfy this condition" -- the
    // plan-rule evaluator, including its rule that an unrecorded value is
    // UNEVALUABLE rather than a failure. A goal must not punish a trade for
    // a field the trader never filled in.
    const rule = asRule(goal);
    let passed = 0;
    let checked = 0;
    for (const t of inPeriod) {
      const result = evaluateStrategyRules(
        { trade: t.trade, strategyId: "", rules: [rule], adjustments: null },
        "",
      );
      const outcome = result.evaluations[0]?.outcome;
      if (outcome === "pass") {
        passed += 1;
        checked += 1;
      } else if (outcome === "fail") {
        checked += 1;
      }
    }
    if (checked === 0) {
      return empty("No trade in this period recorded the value this goal checks.");
    }
    sample = checked;
    current = (passed / checked) * 100;
  } else if (goal.kind === "reduction") {
    // Counts labels the mistake tracker produced -- detected or hand-tagged.
    current = inPeriod.filter((t) => t.mistakes.includes(goal.mistake_label ?? "")).length;
  } else {
    const stats = summariseSegment(inPeriod);
    switch (goal.metric) {
      case "trade_count":
        current = stats.trades;
        break;
      case "win_rate":
        current = stats.winRate === null ? null : stats.winRate * 100;
        break;
      case "expectancy":
        current = stats.expectancy;
        sample = stats.withR;
        break;
      case "total_r":
        current = stats.totalR;
        sample = stats.withR;
        break;
      case "avg_loss_r": {
        // Losers only, in R -- the figure "keep my average loss under 1R"
        // actually refers to. Expressed as a negative number, matching how R
        // is reported everywhere else, so "at most -1R" reads correctly.
        const losers = inPeriod.filter((t) => (t.dollar_pl ?? 0) < 0 && t.r_multiple != null);
        sample = losers.length;
        current =
          losers.length > 0
            ? losers.reduce((sum, t) => sum + (t.r_multiple ?? 0), 0) / losers.length
            : null;
        break;
      }
      default:
        return empty("This goal uses a measure this version doesn't understand.");
    }
    if (current === null) {
      return empty("Not enough recorded data in this period to measure this.");
    }
  }

  if (current === null) return empty("Nothing to measure yet.");

  return {
    goal,
    current,
    sample,
    met: meets(current, goal.target, goal.target_direction),
    fraction: fractionOf(current, goal.target, goal.target_direction),
    reason: null,
    periodLabel: label,
  };
}
