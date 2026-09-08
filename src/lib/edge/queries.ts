import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getLocalDayName } from "@/lib/dates/day-of-week";
import { exitedBeforeTarget, holdingDays } from "@/lib/trades/behaviour";
import {
  buildAllSegments,
  rankSegments,
  summariseSegment,
  type Dimension,
  type RankedSegments,
  type SegmentableTrade,
} from "@/lib/segments/engine";

// Find My Edge: rank every way of cutting the journal by expectancy, and name
// the strongest and the weakest.
//
// All the arithmetic lives in lib/segments -- this file only decides WHICH
// cuts to make, and how to link each one back to the trades behind it.
//
// **Two dimensions the brief asks for are deliberately absent**, because the
// data does not exist and inventing it would be the one thing this app must
// never do:
//
//   - SECTOR. There is no sector column and no source for one. `asset_type`
//     and `market` exist and are used instead; neither is a sector.
//   - MARKET REGIME. Classifying bull/bear/sideways needs index history the
//     app does not fetch (the market-data client discards volume and has no
//     concept of an index symbol). That is Feature 6's problem to solve
//     properly, not something to approximate here.

export interface EdgeRow extends SegmentableTrade {
  id: string;
  ticker: string | null;
  direction: string | null;
  market: string | null;
  asset_type: string | null;
  entry_date: string | null;
  exit_date: string;
  dollar_pl: number | null;
  r_multiple: number | null;
  risk_percent: number | null;
  take_profit: number | null;
  exit_price: number | null;
  emotion_before: unknown;
  trade_strategies: { strategies: { name: string; id: string }[] }[];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function strategiesOf(row: EdgeRow): { id: string; name: string }[] {
  return row.trade_strategies
    .flatMap((link) => link.strategies)
    .filter((s): s is { id: string; name: string } => Boolean(s?.name));
}

/** Holding-period buckets. Chosen to separate the genuinely different trades a
 *  journal holds -- intraday, swing, position -- rather than to be even. */
function holdingBucket(days: number): string {
  if (days < 1) return "Intraday";
  if (days <= 2) return "1–2 days";
  if (days <= 7) return "3–7 days";
  if (days <= 30) return "8–30 days";
  return "Over 30 days";
}

/**
 * The cuts, each with a drill-down where the trades page can express it.
 *
 * A null drill-down is honest rather than lazy: day of week and holding period
 * are computed from timestamps, not stored as columns, so no server-side
 * filter can reproduce the segment. A link that showed *almost* those trades
 * would be worse than no link.
 */
export function edgeDimensions(timezone: string | null): Dimension<EdgeRow>[] {
  return [
    {
      id: "strategy",
      label: "Strategy",
      valuesOf: (row) => strategiesOf(row).map((s) => s.name),
      drillDown: (value, trades) => {
        // The id, not the name: /trades filters strategies by id.
        const match = trades.flatMap(strategiesOf).find((s) => s.name === value);
        return match ? `/trades?strategy=${encodeURIComponent(match.id)}` : null;
      },
    },
    {
      id: "direction",
      label: "Direction",
      valuesOf: (row) => (row.direction ? [row.direction] : []),
      drillDown: (value) => `/trades?direction=${encodeURIComponent(value)}`,
    },
    {
      id: "ticker",
      label: "Instrument",
      valuesOf: (row) => (row.ticker?.trim() ? [row.ticker.trim().toUpperCase()] : []),
      // The search filter matches ticker and company name, which for a ticker
      // is the right set of trades.
      drillDown: (value) => `/trades?q=${encodeURIComponent(value)}`,
    },
    {
      id: "market",
      label: "Market",
      valuesOf: (row) => (row.market?.trim() ? [row.market.trim()] : []),
      drillDown: (value) => `/trades?market=${encodeURIComponent(value)}`,
    },
    {
      id: "emotion",
      label: "Emotion before entry",
      valuesOf: (row) => asStringArray(row.emotion_before),
      drillDown: (value) => `/trades?emotion=${encodeURIComponent(value)}`,
    },
    {
      id: "day",
      label: "Day of week",
      valuesOf: (row) => [getLocalDayName(row.exit_date, timezone)],
      // Computed from a timestamp in the trader's timezone -- not filterable.
    },
    {
      id: "holding",
      label: "Holding period",
      valuesOf: (row) => {
        const days = holdingDays(row);
        return days === null ? [] : [holdingBucket(days)];
      },
    },
    {
      id: "risk",
      label: "Risk per trade",
      valuesOf: (row) => {
        if (row.risk_percent == null) return [];
        if (row.risk_percent < 0.5) return ["Under 0.5%"];
        if (row.risk_percent < 1) return ["0.5–1%"];
        if (row.risk_percent < 2) return ["1–2%"];
        return ["2% or more"];
      },
      drillDown: (value) => {
        const bounds: Record<string, [number | null, number | null]> = {
          "Under 0.5%": [null, 0.5],
          "0.5–1%": [0.5, 1],
          "1–2%": [1, 2],
          "2% or more": [2, null],
        };
        const range = bounds[value];
        if (!range) return null;
        const params = new URLSearchParams();
        if (range[0] !== null) params.set("riskMin", String(range[0]));
        if (range[1] !== null) params.set("riskMax", String(range[1]));
        return `/trades?${params}`;
      },
    },
    {
      id: "exit",
      label: "Exit behaviour",
      // Winners only, for the same reason as the mistake tracker: exiting
      // short of target on a loser is a stop being hit, not an early exit.
      valuesOf: (row) => {
        if ((row.dollar_pl ?? 0) <= 0) return [];
        const early = exitedBeforeTarget(row);
        if (early === null) return [];
        return [early ? "Closed short of target" : "Ran to target"];
      },
    },
  ];
}

export interface EdgeReport extends RankedSegments<EdgeRow> {
  /** Average R across every closed trade, as the baseline a segment beats or
   *  trails. Null when no trade carries an R multiple. */
  overallExpectancy: number | null;
  tradesAnalysed: number;
}

/** Columns the edge dimensions read. Exported so the strategy scorecards can
 *  fetch the same shape and reuse the same dimension definitions rather than
 *  growing a parallel set that could disagree about what "late exit" means. */
export const EDGE_COLUMNS =
  "id, ticker, direction, market, asset_type, entry_date, exit_date, dollar_pl, r_multiple, risk_percent, take_profit, exit_price, emotion_before:custom_fields->emotion_before, trade_strategies(strategies(id, name))";

/** Every closed trade in the shape the dimensions expect, oldest first --
 *  which is also what makes the engine's drawdown meaningful. */
export async function fetchEdgeRows(supabase: SupabaseClient): Promise<EdgeRow[]> {
  return fetchAllRows<EdgeRow>((from, to) =>
    supabase
      .from("trades")
      .select(EDGE_COLUMNS)
      .eq("status", "closed")
      .not("exit_date", "is", null)
      .neq("mode", "investment")
      .order("exit_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export async function getEdgeReport(
  supabase: SupabaseClient,
  timezone: string | null,
): Promise<EdgeReport> {
  const rows = await fetchEdgeRows(supabase);

  const ranked = rankSegments(buildAllSegments(rows, edgeDimensions(timezone)));

  return {
    ...ranked,
    overallExpectancy: summariseSegment(rows).expectancy,
    tradesAnalysed: rows.length,
  };
}
