import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocalDayName, WEEKDAY_ORDER } from "@/lib/dates/day-of-week";

const EMOTION_BEFORE_KEY = "emotion_before";

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

interface SegmentStats {
  trades: number;
  wins: number;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === "string") as string[]) : [];
}

function addToSegment(map: Map<string, SegmentStats>, key: string, won: boolean) {
  const bucket = map.get(key) ?? { trades: 0, wins: 0 };
  bucket.trades += 1;
  if (won) bucket.wins += 1;
  map.set(key, bucket);
}

// Flags segments whose win rate deviates meaningfully (>= MIN_DEVIATION)
// from the overall win rate and has enough trades (>= MIN_SAMPLE_SIZE) to
// not just be noise. This is a statistical pass over the same closed-trade
// rows the analytics module already aggregates -- not an LLM call -- so
// every insight traces back to a concrete, re-computable segment.
function buildInsights(
  dimensionLabel: string,
  segments: Map<string, SegmentStats>,
  overallWinRate: number,
  template: (label: string, rate: number) => string,
): Insight[] {
  const insights: Insight[] = [];
  const chart = Array.from(segments.entries())
    .filter(([, stats]) => stats.trades >= MIN_SAMPLE_SIZE)
    .map(([label, stats]) => ({ label, winRate: stats.wins / stats.trades, trades: stats.trades }));

  if (dimensionLabel === "day") {
    chart.sort((a, b) => WEEKDAY_ORDER.indexOf(a.label) - WEEKDAY_ORDER.indexOf(b.label));
  }

  for (const [label, stats] of segments) {
    if (stats.trades < MIN_SAMPLE_SIZE) continue;
    const rate = stats.wins / stats.trades;
    const deviation = rate - overallWinRate;
    if (Math.abs(deviation) < MIN_DEVIATION) continue;

    insights.push({
      id: `${dimensionLabel}:${label}`,
      segmentLabel: label,
      text: template(label, rate),
      segmentWinRate: rate,
      overallWinRate,
      trades: stats.trades,
      direction: deviation > 0 ? "positive" : "negative",
      chart,
    });
  }

  return insights;
}

export async function getInsights(
  supabase: SupabaseClient,
  timezone: string | null,
): Promise<Insight[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("exit_date, dollar_pl, direction, risk_percent, custom_fields, trade_strategies(strategies(name))")
    .eq("status", "closed")
    .not("exit_date", "is", null);

  if (error) throw error;

  const rows = data as {
    exit_date: string;
    dollar_pl: number | null;
    direction: string | null;
    risk_percent: number | null;
    custom_fields: Record<string, unknown>;
    trade_strategies: { strategies: { name: string }[] }[];
  }[];

  if (rows.length < MIN_SAMPLE_SIZE) return [];

  let overallWins = 0;
  const byDay = new Map<string, SegmentStats>();
  const byDirection = new Map<string, SegmentStats>();
  const byTag = new Map<string, SegmentStats>();
  const byEmotion = new Map<string, SegmentStats>();
  const byRisk = new Map<string, SegmentStats>();

  for (const row of rows) {
    const won = (row.dollar_pl ?? 0) > 0;
    if (won) overallWins += 1;

    const day = getLocalDayName(row.exit_date, timezone);
    addToSegment(byDay, day, won);

    if (row.direction) addToSegment(byDirection, row.direction, won);

    const strategyNames = row.trade_strategies
      .flatMap((link) => link.strategies)
      .map((s) => s?.name)
      .filter((name): name is string => typeof name === "string" && name.trim() !== "");
    for (const name of strategyNames) {
      addToSegment(byTag, name, won);
    }

    for (const emotion of asStringArray(row.custom_fields?.[EMOTION_BEFORE_KEY])) {
      addToSegment(byEmotion, emotion, won);
    }

    if (row.risk_percent != null) {
      const label = row.risk_percent < 1 ? "under 1% risk" : "1%+ risk";
      addToSegment(byRisk, label, won);
    }
  }

  const overallWinRate = overallWins / rows.length;

  return [
    ...buildInsights("day", byDay, overallWinRate, (label, rate) => `You win ${(rate * 100).toFixed(0)}% of trades on ${label}s.`),
    ...buildInsights("direction", byDirection, overallWinRate, (label, rate) => `Your ${label} trades win ${(rate * 100).toFixed(0)}% of the time.`),
    ...buildInsights("tag", byTag, overallWinRate, (label, rate) => `You win ${(rate * 100).toFixed(0)}% of trades using the "${label}" strategy.`),
    ...buildInsights("emotion", byEmotion, overallWinRate, (label, rate) => `You win ${(rate * 100).toFixed(0)}% of trades entered while feeling "${label}".`),
    ...buildInsights("risk", byRisk, overallWinRate, (label, rate) => `You win ${(rate * 100).toFixed(0)}% of trades with ${label}.`),
  ].sort((a, b) => Math.abs(b.segmentWinRate - b.overallWinRate) - Math.abs(a.segmentWinRate - a.overallWinRate));
}
