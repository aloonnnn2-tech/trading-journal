import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { isMissingTableError } from "@/lib/supabase/errors";
import { fetchYahooCandles, guessYahooSymbol, type Candle } from "@/lib/market-data/yahoo";
import {
  calculateExcursion,
  isDailyResolution,
  type ExcursionResult,
  type ExcursionStatus,
} from "./calculate";

// Computing excursions for a journal, and storing them.
//
// **Fetching is batched by SYMBOL, not by trade.** One pull of a ticker's
// daily history covers every trade ever taken on it, so a 50-trade journal
// across 17 tickers costs 17 outbound requests rather than 50. That is the
// difference between polite use of an undocumented endpoint and getting this
// app's IP throttled.
//
// Every failure is recorded rather than swallowed: a trade whose symbol could
// not be resolved gets a row saying so, which is what lets the UI distinguish
// "never computed" (no row) from "computed, and there is nothing to show".

/**
 * Bars are fetched once per symbol and reused across its trades.
 *
 * **NOT `max`.** Asking for `range=max` with `interval=1d` silently returns
 * QUARTERLY bars, not daily ones -- measured against this app's own client:
 * AAPL over `max` came back as 168 bars at a 92-day median gap, while `10y`
 * gave 2,513 bars one day apart. A quarterly high/low spans three months, so
 * excursions built from it would be enormous and wrong.
 *
 * 10 years of daily bars is longer than any realistic journal and stays on the
 * daily side of that cliff. isDailyResolution() checks the result anyway.
 */
const HISTORY_RANGE = "10y";

export interface ExcursionRow {
  trade_id: string;
  symbol: string;
  status: ExcursionStatus;
  mae_price: number | null;
  mfe_price: number | null;
  mae_percent: number | null;
  mfe_percent: number | null;
  mae_r: number | null;
  mfe_r: number | null;
  candles_used: number;
  includes_partial_days: boolean;
  computed_at: string;
}

interface TradeForExcursion {
  id: string;
  ticker: string | null;
  asset_type: string | null;
  direction: string | null;
  entry_price: number | null;
  exit_price: number | null;
  stop_loss: number | null;
  entry_date: string | null;
  exit_date: string | null;
}

const TRADE_COLUMNS =
  "id, ticker, asset_type, direction, entry_price, exit_price, stop_loss, entry_date, exit_date";

/**
 * The calendar day a timestamp falls on **at the exchange**, which is what
 * Candle.time is keyed by (see the timezone handling in yahoo.ts).
 *
 * Approximated as the UTC day. This is the one deliberate imprecision in the
 * feature: without knowing each trade's exchange, a trade entered late in the
 * evening in a western timezone can be attributed to the following bar. The
 * effect is bounded -- one bar at each end of a multi-day hold, on a figure
 * already declared an outer bound by `includesPartialDays` -- and the
 * alternative would be storing an exchange per trade, which the app does not
 * model.
 */
function toDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** A result carrying no figures, for the cases decided before the calculator
 *  is reached. Mirrors calculate.ts's own empty shape. */
function emptyResult(status: ExcursionStatus): ExcursionResult {
  return {
    status,
    maePrice: null,
    mfePrice: null,
    maePercent: null,
    mfePercent: null,
    maeR: null,
    mfeR: null,
    candlesUsed: 0,
    includesPartialDays: false,
  };
}

const EXCURSION_COLUMNS =
  "trade_id, symbol, status, mae_price, mfe_price, mae_percent, mfe_percent, mae_r, mfe_r, candles_used, includes_partial_days, computed_at";

export async function listExcursions(supabase: SupabaseClient): Promise<ExcursionRow[]> {
  const { data, error } = await supabase.from("trade_excursions").select(EXCURSION_COLUMNS);

  if (error) {
    // A pending migration degrades to "nothing computed yet", not a broken
    // page. The compute route reports the missing table properly.
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as ExcursionRow[];
}

/**
 * One trade's excursion, or null when it has never been measured.
 *
 * A targeted read rather than filtering listExcursions(): the trade page needs
 * exactly one row, and pulling the whole journal's worth to find it would grow
 * with the journal for no reason.
 */
export async function getExcursion(
  supabase: SupabaseClient,
  tradeId: string,
): Promise<ExcursionRow | null> {
  const { data, error } = await supabase
    .from("trade_excursions")
    .select(EXCURSION_COLUMNS)
    .eq("trade_id", tradeId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as unknown as ExcursionRow) ?? null;
}

export interface ComputeSummary {
  /** Trades that now carry a usable excursion. */
  computed: number;
  /** Trades answered, but with no figures -- keyed by why. */
  skipped: Record<string, number>;
  /** Symbols whose history could not be fetched at all. */
  symbolsFailed: string[];
  tradesConsidered: number;
}

/**
 * Computes and stores excursions for every closed trade.
 *
 * Recomputes everything rather than only the missing rows: bars get revised,
 * a trade's entry price gets corrected, and a stale excursion is worse than a
 * missing one because nothing on screen would suggest it is out of date.
 */
export async function computeExcursions(
  supabase: SupabaseClient,
  userId: string,
): Promise<ComputeSummary> {
  const trades = await fetchAllRows<TradeForExcursion>((from, to) =>
    supabase
      .from("trades")
      .select(TRADE_COLUMNS)
      .eq("status", "closed")
      .not("exit_date", "is", null)
      // Investment positions have no entry/exit-price P&L anywhere in this
      // app, so an excursion against their entry would measure nothing.
      .neq("mode", "investment")
      .order("id", { ascending: true })
      .range(from, to),
  );

  const summary: ComputeSummary = {
    computed: 0,
    skipped: {},
    symbolsFailed: [],
    tradesConsidered: trades.length,
  };
  if (trades.length === 0) return summary;

  // ---- One fetch per distinct symbol --------------------------------------
  const bySymbol = new Map<string, TradeForExcursion[]>();
  for (const trade of trades) {
    const symbol = guessYahooSymbol(trade.ticker ?? "", trade.asset_type);
    if (!symbol) continue;
    (bySymbol.get(symbol) ?? bySymbol.set(symbol, []).get(symbol)!).push(trade);
  }

  const rows: (ExcursionRow & { user_id: string })[] = [];

  for (const [symbol, symbolTrades] of bySymbol) {
    let candles: Candle[] = [];
    let coarse = false;
    try {
      const result = await fetchYahooCandles(symbol, { range: HISTORY_RANGE });
      candles = result?.candles ?? [];
    } catch {
      candles = [];
    }
    if (candles.length === 0) {
      summary.symbolsFailed.push(symbol);
    } else if (!isDailyResolution(candles)) {
      // The provider gave a coarser series than asked for. Refusing beats
      // computing an excursion from bars that span months.
      summary.symbolsFailed.push(`${symbol} (not daily data)`);
      candles = [];
      coarse = true;
    }

    for (const trade of symbolTrades) {
      // A coarse series is refused for every trade on that symbol: computing
      // from bars spanning months would produce a confident, enormous, wrong
      // excursion -- the one failure mode this feature must not have.
      const result = coarse
        ? emptyResult("coarse_data")
        : calculateExcursion({
            direction: trade.direction,
            entryPrice: trade.entry_price,
            exitPrice: trade.exit_price,
            stopLoss: trade.stop_loss,
            entryDay: toDay(trade.entry_date ?? trade.exit_date ?? ""),
            exitDay: toDay(trade.exit_date ?? ""),
            candles,
          });

      if (result.status === "ok") summary.computed += 1;
      else summary.skipped[result.status] = (summary.skipped[result.status] ?? 0) + 1;

      rows.push({
        user_id: userId,
        trade_id: trade.id,
        symbol,
        status: result.status,
        mae_price: result.maePrice,
        mfe_price: result.mfePrice,
        mae_percent: result.maePercent,
        mfe_percent: result.mfePercent,
        mae_r: result.maeR,
        mfe_r: result.mfeR,
        candles_used: result.candlesUsed,
        includes_partial_days: result.includesPartialDays,
        computed_at: new Date().toISOString(),
      });
    }
  }

  // One upsert for the lot. Chunked because a single statement with a very
  // large payload is the kind of thing that works on a small journal and
  // fails on a big one.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("trade_excursions")
      .upsert(rows.slice(i, i + 200), { onConflict: "trade_id" });
    if (error) throw error;
  }

  return summary;
}
