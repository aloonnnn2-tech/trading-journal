import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { localDateParts } from "@/lib/dates/local-day";
import {
  MIN_SEGMENT_TRADES,
  buildSegments,
  summariseSegment,
  type Dimension,
  type SegmentStats,
} from "@/lib/segments/engine";
import { buildMistakeTrades } from "@/lib/mistakes/queries";
import { lossStreakBefore } from "@/lib/trades/behaviour";

// The Emotions page, rebuilt (Alon, 2026-10-17: "not good enough, make it
// useful"). Four questions, each answered from the same closed trades:
//
//   1. Which feelings cost money?   -- results by emotion, before / during /
//      after, and by how intense it was.
//   2. Do I tilt?                    -- trades taken straight after losses,
//      against the rest.
//   3. How has it been going?        -- emotions logged and results, by week
//      or month.
//   4. Which feelings lead to mistakes? -- how often a trade entered with
//      each emotion broke a rule or carried a mistake tag.
//
// All arithmetic is the segments engine's, so a win rate or an expectancy
// here means exactly what it means on Analytics and Insights. Anything
// resting on fewer than MIN_SEGMENT_TRADES trades is marked, not judged
// (docs/design-audit.md: no number that isn't true).

export const PHASES = ["before", "during", "after"] as const;
export type Phase = (typeof PHASES)[number];

export interface EmotionTrade {
  id: string;
  ticker: string | null;
  dollar_pl: number | null;
  r_multiple: number | null;
  entry_date: string | null;
  exit_date: string | null;
  /** Position size in dollars, for the tilt sizing comparison. */
  size: number | null;
  emotions: Record<Phase, string[]>;
  intensity: number | null;
}

export interface EmotionRow {
  emotion: string;
  stats: SegmentStats;
  /** Below MIN_SEGMENT_TRADES: shown, never ranked or called good or bad. */
  thin: boolean;
  /** /trades filtered to this emotion. */
  href: string;
}

export interface TiltGroup {
  key: "after_2_losses" | "after_1_loss" | "otherwise";
  label: string;
  stats: SegmentStats;
  thin: boolean;
  /** Median size in this group over the median size of all trades; null without sizes. */
  sizeVsUsual: number | null;
  /** The emotion most often logged before these trades. */
  topEmotion: string | null;
}

export interface PeriodRow {
  /** "2026-10" or the Monday "2026-10-12". */
  key: string;
  label: string;
  trades: number;
  logged: number;
  totalPL: number;
  expectancy: number | null;
  /** The most-logged emotions before entering, most first (up to three). */
  topEmotions: { emotion: string; count: number }[];
}

export interface MistakeLink {
  emotion: string;
  trades: number;
  withMistake: number;
  rate: number;
  /** The most common mistakes among them. */
  topMistakes: { label: string; count: number }[];
  thin: boolean;
}

export interface EmotionReport {
  closedTrades: number;
  /** Closed trades with at least one emotion logged. */
  loggedTrades: number;
  byPhase: Record<Phase, EmotionRow[]>;
  byIntensity: EmotionRow[];
  tilt: TiltGroup[] | null;
  periods: { unit: "week" | "month"; rows: PeriodRow[] };
  mistakes: { overallRate: number; trades: number; rows: MistakeLink[] } | null;
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

const hasEmotion = (t: EmotionTrade) => PHASES.some((p) => t.emotions[p].length > 0) || t.intensity != null;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function topCounts(values: string[], limit: number): { emotion: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([emotion, count]) => ({ emotion, count }));
}

function rowsFor(trades: EmotionTrade[], dimension: Dimension<EmotionTrade>, href: (value: string) => string): EmotionRow[] {
  return buildSegments(trades, dimension).map((s) => ({
    emotion: s.value,
    stats: s.stats,
    thin: s.stats.trades < MIN_SEGMENT_TRADES,
    href: href(s.value),
  }));
}

const INTENSITY_BUCKETS = [
  { label: "Low (1–3)", min: 1, max: 3 },
  { label: "Medium (4–6)", min: 4, max: 6 },
  { label: "High (7–10)", min: 7, max: 10 },
];

/** Consecutive losses among the trades that closed before `trade` was entered. */
function lossesBefore(trade: EmotionTrade, all: EmotionTrade[]): number {
  // Shared with the AI review's "run of results before this trade".
  return lossStreakBefore(trade.entry_date, all, trade.id);
}

function periodKey(iso: string, unit: "week" | "month", timezone: string | null): { key: string; label: string } {
  const { year, month, day } = localDateParts(new Date(iso), timezone);
  if (unit === "month") {
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
    return { key, label };
  }
  // The Monday of that local week.
  const d = new Date(Date.UTC(year, month, day));
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  const key = monday.toISOString().slice(0, 10);
  const label = `Week of ${monday.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  return { key, label };
}

/**
 * Everything the page shows, from closed trades (oldest exit first) and each
 * trade's mistakes (buildMistakeTrades; null when that couldn't be read).
 */
export function buildEmotionReport(
  trades: EmotionTrade[],
  mistakesByTrade: Map<string, string[]> | null,
  timezone: string | null,
): EmotionReport {
  const logged = trades.filter(hasEmotion);
  const emotionHref = (value: string) => `/trades?emotion=${encodeURIComponent(value)}`;

  const byPhase = Object.fromEntries(
    PHASES.map((phase) => [
      phase,
      rowsFor(trades, { id: phase, label: phase, valuesOf: (t) => t.emotions[phase] }, emotionHref),
    ]),
  ) as Record<Phase, EmotionRow[]>;

  const byIntensity = INTENSITY_BUCKETS.map((b) => {
    const inBucket = trades.filter((t) => t.intensity != null && t.intensity >= b.min && t.intensity <= b.max);
    const stats = summariseSegment(inBucket);
    return { emotion: b.label, stats, thin: stats.trades < MIN_SEGMENT_TRADES, href: "/emotions" };
  }).filter((r) => r.stats.trades > 0);

  // ---- tilt ----------------------------------------------------------------
  const sizes = trades.map((t) => t.size).filter((s): s is number => s != null && s > 0);
  const usualSize = median(sizes);
  const groups: Record<TiltGroup["key"], EmotionTrade[]> = { after_2_losses: [], after_1_loss: [], otherwise: [] };
  for (const t of trades) {
    const n = lossesBefore(t, trades);
    groups[n >= 2 ? "after_2_losses" : n === 1 ? "after_1_loss" : "otherwise"].push(t);
  }
  const labels: Record<TiltGroup["key"], string> = {
    after_2_losses: "After 2+ losses in a row",
    after_1_loss: "After 1 loss",
    otherwise: "After a win, or a fresh start",
  };
  const tiltGroups: TiltGroup[] = (Object.keys(groups) as TiltGroup["key"][]).map((key) => {
    const g = groups[key];
    const stats = summariseSegment(g);
    const groupSize = median(g.map((t) => t.size).filter((s): s is number => s != null && s > 0));
    return {
      key,
      label: labels[key],
      stats,
      thin: stats.trades < MIN_SEGMENT_TRADES,
      sizeVsUsual: groupSize != null && usualSize ? groupSize / usualSize : null,
      topEmotion: topCounts(g.flatMap((t) => t.emotions.before), 1)[0]?.emotion ?? null,
    };
  });
  // Only worth showing when there is something after losses to compare.
  const tilt = tiltGroups.some((g) => g.key !== "otherwise" && g.stats.trades > 0) ? tiltGroups : null;

  // ---- over time --------------------------------------------------------------
  const dated = trades.filter((t) => t.exit_date);
  const spanDays =
    dated.length > 1 ? (Date.parse(dated[dated.length - 1].exit_date!) - Date.parse(dated[0].exit_date!)) / 86_400_000 : 0;
  const unit: "week" | "month" = spanDays > 16 * 7 ? "month" : "week";
  const periodMap = new Map<string, { label: string; trades: EmotionTrade[] }>();
  for (const t of dated) {
    const { key, label } = periodKey(t.exit_date!, unit, timezone);
    (periodMap.get(key) ?? periodMap.set(key, { label, trades: [] }).get(key)!).trades.push(t);
  }
  const periodRows: PeriodRow[] = [...periodMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([key, { label, trades: ts }]) => {
      const stats = summariseSegment(ts);
      return {
        key,
        label,
        trades: ts.length,
        logged: ts.filter(hasEmotion).length,
        totalPL: stats.totalPL,
        expectancy: stats.withR > 0 ? stats.expectancy : null,
        topEmotions: topCounts(ts.flatMap((t) => t.emotions.before), 3),
      };
    });

  // ---- emotion -> mistakes ------------------------------------------------
  let mistakes: EmotionReport["mistakes"] = null;
  if (mistakesByTrade) {
    const known = trades.filter((t) => mistakesByTrade.has(t.id));
    const withAny = known.filter((t) => (mistakesByTrade.get(t.id) ?? []).length > 0).length;
    if (known.length > 0) {
      const rows = buildSegments(known, { id: "before", label: "before", valuesOf: (t) => t.emotions.before }).map((s) => {
        const tagged = s.trades.filter((t) => (mistakesByTrade.get(t.id) ?? []).length > 0);
        const labelsSeen = s.trades.flatMap((t) => mistakesByTrade.get(t.id) ?? []);
        return {
          emotion: s.value,
          trades: s.trades.length,
          withMistake: tagged.length,
          rate: tagged.length / s.trades.length,
          topMistakes: topCounts(labelsSeen, 3).map(({ emotion: label, count }) => ({ label, count })),
          thin: s.trades.length < MIN_SEGMENT_TRADES,
        };
      });
      mistakes = { overallRate: withAny / known.length, trades: known.length, rows };
    }
  }

  return {
    closedTrades: trades.length,
    loggedTrades: logged.length,
    byPhase,
    byIntensity,
    tilt,
    periods: { unit, rows: periodRows },
    mistakes,
  };
}

interface Row {
  id: string;
  ticker: string | null;
  dollar_pl: number | null;
  r_multiple: number | null;
  entry_date: string | null;
  exit_date: string | null;
  dollar_amount: number | null;
  position_size: number | null;
  emotion_before: unknown;
  emotion_during: unknown;
  emotion_after: unknown;
  emotion_intensity: unknown;
}

export async function getEmotionReport(supabase: SupabaseClient, timezone: string | null): Promise<EmotionReport> {
  // The same population every stats module uses: closed, with an exit date,
  // not an investment -- oldest exit first, which the engine's drawdown and
  // the tilt streaks both depend on. Only the four emotion keys come back
  // out of custom_fields.
  const [rows, mistakeTrades] = await Promise.all([
    fetchAllRows<Row>((from, to) =>
      supabase
        .from("trades")
        .select(
          "id, ticker, dollar_pl, r_multiple, entry_date, exit_date, dollar_amount, position_size, emotion_before:custom_fields->emotion_before, emotion_during:custom_fields->emotion_during, emotion_after:custom_fields->emotion_after, emotion_intensity:custom_fields->emotion_intensity",
        )
        .eq("status", "closed")
        .not("exit_date", "is", null)
        .neq("mode", "investment")
        .order("exit_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // An enrichment: the page still works if the mistakes read fails.
    buildMistakeTrades(supabase).catch(() => null),
  ]);

  const trades: EmotionTrade[] = rows.map((r) => ({
    id: r.id,
    ticker: r.ticker,
    dollar_pl: r.dollar_pl,
    r_multiple: r.r_multiple,
    entry_date: r.entry_date,
    exit_date: r.exit_date,
    size: r.dollar_amount ?? r.position_size ?? null,
    emotions: { before: asStrings(r.emotion_before), during: asStrings(r.emotion_during), after: asStrings(r.emotion_after) },
    intensity: typeof r.emotion_intensity === "number" ? r.emotion_intensity : null,
  }));
  const mistakesByTrade = mistakeTrades
    ? new Map(mistakeTrades.map((m) => [m.id, [...new Set(m.mistakes.map((x) => x.label))]]))
    : null;
  return buildEmotionReport(trades, mistakesByTrade, timezone);
}
