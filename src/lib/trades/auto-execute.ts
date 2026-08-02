import type { Trade } from "./types";

/** The price facts an auto-execution decision is made from. */
export interface PriceLevels {
  dayHigh: number | null;
  dayLow: number | null;
}

/** The subset of a trade the decision reads. */
export type AutoExecutableTrade = Pick<
  Trade,
  "mode" | "status" | "direction" | "entry_price" | "stop_loss" | "take_profit" | "entry_date"
>;

export interface AutoExecutionDecision {
  /** Field updates to apply. */
  changes: {
    status: "open" | "closed";
    entry_date?: string;
    exit_price?: number;
    exit_date?: string;
  };
  /** Which level triggered it -- drives the user-facing message. */
  trigger: "entry" | "stop_loss" | "take_profit";
  /** The price level that was touched. */
  price: number;
}

/**
 * Decides whether a trade should advance, given the session's high/low.
 *
 * Pure and side-effect free so the browser hook (which watches a single open
 * trade) and the scheduled background job (which sweeps every user's trades)
 * make *identical* decisions -- previously this logic lived only inside a
 * React hook, which is why a trade could only auto-execute while its page
 * happened to be open.
 *
 * Returns null when nothing should happen.
 */
export function decideAutoExecution(
  trade: AutoExecutableTrade,
  levels: PriceLevels,
  now: Date = new Date(),
): AutoExecutionDecision | null {
  // Investment positions have no entry/stop/target levels to watch.
  if (trade.mode === "investment") return null;

  const { dayHigh, dayLow } = levels;
  if (dayHigh == null || dayLow == null) return null;
  if (dayLow > dayHigh) return null; // malformed snapshot

  // pending -> open: the session's range brackets the entry price. Checked
  // as a bracket rather than a directional cross because the app stores a
  // single trigger price, not a limit-vs-stop order sub-type.
  if (trade.status === "pending") {
    const entry = trade.entry_price;
    if (entry == null || dayLow > entry || entry > dayHigh) return null;
    return {
      changes: {
        status: "open",
        ...(trade.entry_date ? {} : { entry_date: now.toISOString() }),
      },
      trigger: "entry",
      price: entry,
    };
  }

  // open -> closed. Which side is "the stop" and which "the target" depends
  // on direction, so without one set we genuinely can't tell a stop-out from
  // a take-profit -- guessing could misfile a loss as a win, so this
  // deliberately does nothing until direction is set.
  if (trade.status !== "open" || !trade.direction) return null;

  const long = trade.direction === "long";
  const stopHit =
    trade.stop_loss != null && (long ? dayLow <= trade.stop_loss : dayHigh >= trade.stop_loss);
  const targetHit =
    trade.take_profit != null && (long ? dayHigh >= trade.take_profit : dayLow <= trade.take_profit);

  if (!stopHit && !targetHit) return null;

  // One session's high/low can bracket both levels, with no way to tell from
  // daily data which was touched first -- the stop wins, so an ambiguous day
  // is never optimistically recorded as a win.
  const exitPrice = stopHit ? trade.stop_loss! : trade.take_profit!;
  return {
    changes: {
      status: "closed",
      exit_price: exitPrice,
      exit_date: now.toISOString(),
      // `result` is deliberately not set here: hitting the target is not the
      // same as netting a profit once commission is subtracted, and this
      // function doesn't have `shares`/commission to compute the real net
      // P&L. Callers derive `result` themselves from the commission-net
      // `dollar_pl` after applying these changes (see resultFromPL).
    },
    trigger: stopHit ? "stop_loss" : "take_profit",
    price: exitPrice,
  };
}

/** Whether a trade is worth spending a price lookup on at all. */
export function isWatchable(trade: AutoExecutableTrade): boolean {
  if (trade.mode === "investment") return false;
  if (trade.status === "pending") return trade.entry_price != null;
  if (trade.status === "open") {
    return Boolean(trade.direction) && (trade.stop_loss != null || trade.take_profit != null);
  }
  return false;
}

/** User-facing sentence for a decision, shared by the banner and the job log. */
export function describeAutoExecution(decision: AutoExecutionDecision): string {
  const price = decision.price.toLocaleString(undefined, { maximumFractionDigits: 8 });
  if (decision.trigger === "entry") return `Entry hit at $${price} — marked as open.`;
  const label = decision.trigger === "stop_loss" ? "Stop loss" : "Take profit";
  return `${label} hit at $${price} — trade closed.`;
}
