import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { fetchYahooCandles } from "@/lib/market-data/yahoo";
import { buildSegments, type Dimension, type Segment } from "@/lib/segments/engine";
import { buildRegimeSeries, isBenchmarkRelevant, regimeOn, VOL_WINDOW } from "./classify";

// Breaking a journal down by the market volatility each trade closed in.
//
// **No storage and no migration.** The classification is a pure function of
// public price history, so writing it down would only create a copy that could
// go stale. One benchmark fetch serves the whole analysis, and the existing
// client already caches it -- unlike per-trade excursions, this is the same
// request for every user, so it costs one upstream call however many people
// load the page.

/**
 * The benchmark. SPY rather than ^GSPC because it is the tradeable instrument
 * most journals here are implicitly measured against, and it returns clean
 * daily bars over a decade (verified: 2,513 of them).
 *
 * Not user-configurable yet. When it becomes so, the label in the UI has to
 * follow it -- a figure headed "high volatility" means nothing without saying
 * high volatility in WHAT.
 */
export const BENCHMARK_SYMBOL = "SPY";

/** Ten years of daily bars. NOT `max`, which silently returns quarterly data --
 *  see the note on HISTORY_RANGE in lib/excursions/queries.ts. */
const BENCHMARK_RANGE = "10y";

interface RegimeTrade {
  id: string;
  dollar_pl: number | null;
  r_multiple: number | null;
  exit_date: string;
  asset_type: string | null;
}

export interface RegimeReport {
  /** One segment per volatility band, with the shared engine's stats. */
  segments: Segment<RegimeTrade>[];
  benchmark: string;
  /** The split point, so the UI can say what "high" means in numbers. */
  medianVolatility: number;
  /** Trades excluded because an equity benchmark does not describe them. */
  excludedByAsset: number;
  /** Trades whose exit date matched no session within the carry-back window. */
  unmatched: number;
  tradesAnalysed: number;
  /** Null when the benchmark could not be fetched at all -- the UI says so
   *  rather than rendering an empty breakdown that looks like "no trades". */
  available: boolean;
}

const EMPTY: RegimeReport = {
  segments: [],
  benchmark: BENCHMARK_SYMBOL,
  medianVolatility: 0,
  excludedByAsset: 0,
  unmatched: 0,
  tradesAnalysed: 0,
  available: false,
};

export async function getRegimeReport(supabase: SupabaseClient): Promise<RegimeReport> {
  const [trades, benchmark] = await Promise.all([
    fetchAllRows<RegimeTrade>((from, to) =>
      supabase
        .from("trades")
        .select("id, dollar_pl, r_multiple, exit_date, asset_type")
        .eq("status", "closed")
        .not("exit_date", "is", null)
        // Same exclusion as every other stats module.
        .neq("mode", "investment")
        .order("exit_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchYahooCandles(BENCHMARK_SYMBOL, { range: BENCHMARK_RANGE }).catch(() => null),
  ]);

  const series = benchmark ? buildRegimeSeries(benchmark.candles) : null;
  if (!series) return { ...EMPTY, tradesAnalysed: trades.length };

  // Filtering happens before segmentation so the counts the UI reports are the
  // counts the segments were actually built from.
  const relevant = trades.filter((t) => isBenchmarkRelevant(t.asset_type));
  const excludedByAsset = trades.length - relevant.length;

  const matched: RegimeTrade[] = [];
  let unmatched = 0;
  for (const trade of relevant) {
    // The exit day as a calendar date. Same UTC approximation as the
    // excursion feature; the carry-back absorbs a one-day slip.
    if (regimeOn(series, trade.exit_date.slice(0, 10))) matched.push(trade);
    else unmatched += 1;
  }

  const dimension: Dimension<RegimeTrade> = {
    id: "volatility",
    label: "Market volatility",
    valuesOf: (trade) => {
      const regime = regimeOn(series, trade.exit_date.slice(0, 10));
      return regime ? [regime.band === "high" ? "High volatility" : "Low volatility"] : [];
    },
    // No drill-down: volatility is a property of the market on a date, not a
    // column on the trade, so no /trades filter can reproduce the segment.
  };

  return {
    segments: buildSegments(matched, dimension),
    benchmark: BENCHMARK_SYMBOL,
    medianVolatility: series.medianVolatility,
    excludedByAsset,
    unmatched,
    tradesAnalysed: matched.length,
    available: true,
  };
}

export { VOL_WINDOW };
