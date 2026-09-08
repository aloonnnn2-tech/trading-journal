import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getLocalDayName, WEEKDAY_ORDER } from "@/lib/dates/day-of-week";
import { buildSegments, type Dimension, type Segment } from "@/lib/segments/engine";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === "string") as string[]) : [];
}

const MIN_SAMPLE_SIZE = 5;
const MIN_DEVIATION = 0.15; // 15 percentage points away from overall win rate

export interface Insight {
  id: string;
  segmentLabel: string;
  text: string;
  segmentWinRate: number;
  overallWinRate: number;
  trades: number;
  direction: "positive" | "negative";
  chart: { label: string; winRate: number; trades: number }[];
}

// Flags segments whose win rate deviates meaningfully (>= MIN_DEVIATION)
// from the overall win rate and has enough trades (>= MIN_SAMPLE_SIZE) to
// not just be noise. This is a statistical pass over the same closed-trade
// rows the analytics module already aggregates -- not an LLM call -- so
// every insight traces back to a concrete, re-computable segment.
function buildInsights(
  dimensionLabel: string,
  segments: Segment<InsightRow>[],
  overallWinRate: number,
  template: (label: string, rate: number) => string,
): Insight[] {
  const insights: Insight[] = [];
  const chart = segments
    .filter((segment) => segment.stats.trades >= MIN_SAMPLE_SIZE)
    .map((segment) => ({
      label: segment.value,
      winRate: segment.stats.winRate ?? 0,
      trades: segment.stats.trades,
    }));

  if (dimensionLabel === "day") {
    chart.sort((a, b) => WEEKDAY_ORDER.indexOf(a.label) - WEEKDAY_ORDER.indexOf(b.label));
  }

  for (const segment of segments) {
    if (segment.stats.trades < MIN_SAMPLE_SIZE) continue;
    const rate = segment.stats.winRate ?? 0;
    const deviation = rate - overallWinRate;
    if (Math.abs(deviation) < MIN_DEVIATION) continue;

    insights.push({
      id: `${dimensionLabel}:${segment.value}`,
      segmentLabel: segment.value,
      text: template(segment.value, rate),
      segmentWinRate: rate,
      overallWinRate,
      trades: segment.stats.trades,
      direction: deviation > 0 ? "positive" : "negative",
      chart,
    });
  }

  return insights;
}

/** The row shape the dimensions below read. `id`, `dollar_pl` and
 *  `r_multiple` satisfy SegmentableTrade; the rest are the cut points. */
interface InsightRow {
  id: string;
  exit_date: string;
  dollar_pl: number | null;
  r_multiple: number | null;
  direction: string | null;
  risk_percent: number | null;
  emotion_before: unknown;
  trade_strategies: { strategies: { name: string }[] }[];
}

export async function getInsights(
  supabase: SupabaseClient,
  timezone: string | null,
): Promise<Insight[]> {
  // fetchAllRows: unpaged selects silently cap at 1,000 rows. The emotion
  // key is projected out of the jsonb server-side rather than shipping the
  // whole custom_fields blob (the user's entire notes corpus) per trade.
  const data = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from("trades")
      .select(
        "id, exit_date, dollar_pl, r_multiple, direction, risk_percent, emotion_before:custom_fields->emotion_before, trade_strategies(strategies(name))",
      )
      .eq("status", "closed")
      .not("exit_date", "is", null)
      // See the identical .neq in analytics/queries.ts: investment trades'
      // dollar_pl is always null, so leaving them in silently counts every
      // one as a loss (won = dollar_pl > 0) in every by-day/by-tag/by-emotion
      // pattern below.
      .neq("mode", "investment")
      .order("exit_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const rows = data as unknown as InsightRow[];
  if (rows.length < MIN_SAMPLE_SIZE) return [];

  // The five cuts this page has always made, now expressed as dimensions for
  // the shared engine (lib/segments) rather than five hand-rolled maps. No
  // drill-down urls: this view has never linked out, and adding one here
  // would change behaviour the characterization tests pin.
  const dimensions: Record<string, Dimension<InsightRow>> = {
    day: {
      id: "day",
      label: "Day",
      valuesOf: (row) => [getLocalDayName(row.exit_date, timezone)],
    },
    direction: {
      id: "direction",
      label: "Direction",
      valuesOf: (row) => (row.direction ? [row.direction] : []),
    },
    tag: {
      id: "tag",
      label: "Strategy",
      valuesOf: (row) =>
        row.trade_strategies
          .flatMap((link) => link.strategies)
          .map((s) => s?.name)
          .filter((name): name is string => typeof name === "string" && name.trim() !== ""),
    },
    emotion: {
      id: "emotion",
      label: "Emotion",
      valuesOf: (row) => asStringArray(row.emotion_before),
    },
    risk: {
      id: "risk",
      label: "Risk",
      valuesOf: (row) =>
        row.risk_percent == null ? [] : [row.risk_percent < 1 ? "under 1% risk" : "1%+ risk"],
    },
  };

  const overallWins = rows.filter((row) => (row.dollar_pl ?? 0) > 0).length;
  const overallWinRate = overallWins / rows.length;

  const insightsFor = (
    key: keyof typeof dimensions,
    template: (label: string, rate: number) => string,
  ) => buildInsights(key as string, buildSegments(rows, dimensions[key]), overallWinRate, template);

  return [
    ...insightsFor("day", (label, rate) => `You win ${(rate * 100).toFixed(0)}% of trades on ${label}s.`),
    ...insightsFor("direction", (label, rate) => `Your ${label} trades win ${(rate * 100).toFixed(0)}% of the time.`),
    ...insightsFor("tag", (label, rate) => `You win ${(rate * 100).toFixed(0)}% of trades using the "${label}" strategy.`),
    ...insightsFor("emotion", (label, rate) => `You win ${(rate * 100).toFixed(0)}% of trades entered while feeling "${label}".`),
    ...insightsFor("risk", (label, rate) => `You win ${(rate * 100).toFixed(0)}% of trades with ${label}.`),
  ].sort((a, b) => Math.abs(b.segmentWinRate - b.overallWinRate) - Math.abs(a.segmentWinRate - a.overallWinRate));
}
