import { localDateParts } from "@/lib/dates/local-day";
import type { Trade } from "./types";

/** The price facts an auto-execution decision is made from. */
export interface PriceLevels {
  dayHigh: number | null;
  dayLow: number | null;
  /** When this snapshot's quote was last updated, if known. */
  quoteTime?: Date | null;
}

// dayHigh/dayLow are the *session's* range and don't reset until the next
// session opens -- so without this, a pending order logged at 8pm was
// evaluated on the very next 15-minute sweep against a range that had
// already finished hours earlier, and could fill against a price the market
// never actually revisited. 30 minutes covers a brief data-provider hiccup
// (a quote a few minutes behind) while still catching "the market's been
// closed since 4pm" long before the next session even opens.
const STALE_QUOTE_MAX_AGE_MS = 30 * 60 * 1000;

/** The subset of a trade the decision reads. */
export type AutoExecutableTrade = Pick<
  Trade,
  | "mode"
  | "status"
  | "direction"
  | "entry_price"
  | "stop_loss"
  | "take_profit"
  | "entry_date"
  | "order_type"
  | "limit_price"
  | "time_in_force"
> & { created_at?: string };

/**
 * Whether the session's range satisfies this order type, for this direction.
 *
 * The old rule was a bracket: fill if dayLow <= entry <= dayHigh, from either
 * side. That is wrong for every real order type. A buy limit sits BELOW the
 * market and fills when price comes down to it; a buy stop sits ABOVE and
 * fills when price breaks up through it. Filling both on a bracket meant a
 * buy limit at $95 filled on a day price rallied away from it.
 *
 * Returns the fill price, or null for no fill.
 */
function fillPrice(
  trade: AutoExecutableTrade,
  dayHigh: number,
  dayLow: number,
): number | null {
  const trigger = trade.entry_price;
  if (trigger == null) return null;
  const long = trade.direction === "long";

  switch (trade.order_type) {
    // Nothing to wait for. A market order that is still sitting in `pending`
    // is a bookkeeping state, not a resting order, so the app does not invent
    // a fill for it -- see isWatchable.
    case "market":
      return null;

    // Price has to come TO you.
    case "limit":
      return (long ? dayLow <= trigger : dayHigh >= trigger) ? trigger : null;

    // Price has to break THROUGH you.
    case "stop":
      return (long ? dayHigh >= trigger : dayLow <= trigger) ? trigger : null;

    // Two legs: the stop triggers, then it rests as a limit.
    //
    // **A daily bar cannot prove the order of events.** Both conditions
    // holding on one day does not show the stop was touched before price
    // reached the limit, and the feed has no intraday detail to settle it.
    // Filling on both-conditions-met is the same posture the exit side
    // already takes when one session brackets both the stop and the target:
    // decide, and say plainly what the decision rests on.
    case "stop_limit": {
      const limit = trade.limit_price;
      if (limit == null) return null;
      const triggered = long ? dayHigh >= trigger : dayLow <= trigger;
      if (!triggered) return null;
      const fillable = long ? dayLow <= limit : dayHigh >= limit;
      return fillable ? limit : null;
    }

    // A trail depends on the path price took, and a daily high/low does not
    // contain the path. Recordable so the journal is accurate, never filled
    // automatically -- the same refusal as `coarse_data` on excursions and
    // `unevaluable` on plan rules.
    case "trailing_stop":
      return null;

    // The user named this one themselves, so the app has no idea what its
    // rules are and does not guess at them.
    case "other":
      return null;

    // Unspecified: every trade written before migration 0039. Keeps the
    // original bracket behaviour deliberately, so applying that migration
    // cannot change how an order somebody is already waiting on will fill.
    default:
      return dayLow <= trigger && trigger <= dayHigh ? trigger : null;
  }
}

export interface AutoExecutionDecision {
  /** Field updates to apply. */
  changes: {
    status: "open" | "closed" | "expired";
    entry_date?: string;
    exit_price?: number;
    exit_date?: string;
  };
  /** Which level triggered it -- drives the user-facing message. */
  trigger: "entry" | "stop_loss" | "take_profit" | "expiry";
  /** The price level that was touched. Null when nothing was touched, which
   *  is only the case for an expiry. */
  price: number | null;
  /** Set for a fill, so the message can say which kind of order fired. */
  orderType?: Trade["order_type"];
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

  const { dayHigh, dayLow, quoteTime } = levels;
  if (dayHigh == null || dayLow == null) return null;
  if (dayLow > dayHigh) return null; // malformed snapshot
  // Only checked when we actually know the quote's age -- missing timestamp
  // data isn't evidence of staleness, so this fails open on "unknown" and
  // closed only on "known and old".
  if (quoteTime != null && now.getTime() - quoteTime.getTime() > STALE_QUOTE_MAX_AGE_MS) return null;

  // pending -> open: the session's range brackets the entry price. Checked
  // as a bracket rather than a directional cross because the app stores a
  // single trigger price, not a limit-vs-stop order sub-type.
  if (trade.status === "pending") {
    const filled = fillPrice(trade, dayHigh, dayLow);
    if (filled == null) return null;
    return {
      changes: {
        status: "open",
        ...(trade.entry_date ? {} : { entry_date: now.toISOString() }),
      },
      trigger: "entry",
      price: filled,
      orderType: trade.order_type,
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

/**
 * Whether a resting day order has outlived its session.
 *
 * **Deliberately separate from decideAutoExecution, because it needs no price
 * data.** An expiry is not a fill: nothing was touched, so there is no quote
 * to fetch and no reason to spend a market-data request on it. The sweep can
 * expire a lapsed order even when the price feed is down.
 *
 * The rule is the user's own calendar day, matching how everything else in
 * this app buckets time (lib/dates/local-day.ts). That is an approximation of
 * a market session, since the app does not know which exchange the order was
 * routed to and a New York session does not align with a Tokyo one, so it
 * errs late: the order survives the whole of the day it was placed, in the
 * trader's own timezone, and lapses only once that day is over.
 */
export function hasLapsed(
  trade: Pick<Trade, "status" | "time_in_force"> & { created_at?: string },
  now: Date,
  timezone: string | null,
): boolean {
  if (trade.status !== "pending") return false;
  if (trade.time_in_force !== "day") return false;
  if (!trade.created_at) return false;

  const placed = new Date(trade.created_at);
  if (Number.isNaN(placed.getTime())) return false;

  const a = localDateParts(placed, timezone);
  const b = localDateParts(now, timezone);
  if (b.year !== a.year) return b.year > a.year;
  if (b.month !== a.month) return b.month > a.month;
  return b.day > a.day;
}

/** Whether a trade is worth spending a price lookup on at all. */
export function isWatchable(trade: AutoExecutableTrade): boolean {
  if (trade.mode === "investment") return false;
  if (trade.status === "pending") {
    if (trade.entry_price == null) return false;
    // Nothing about these resolves from a high/low, so a quote would be spent
    // to learn nothing. A market order sitting in `pending` is bookkeeping
    // rather than a resting order; the other two the app cannot evaluate
    // honestly, so it does not pretend to.
    if (
      trade.order_type === "market" ||
      trade.order_type === "trailing_stop" ||
      trade.order_type === "other"
    ) {
      return false;
    }
    // A stop-limit with no limit leg has nothing to rest at.
    if (trade.order_type === "stop_limit" && trade.limit_price == null) return false;
    return true;
  }
  if (trade.status === "open") {
    return Boolean(trade.direction) && (trade.stop_loss != null || trade.take_profit != null);
  }
  return false;
}

/** User-facing sentence for a decision, shared by the banner and the job log. */
const ENTRY_VERB: Record<string, string> = {
  limit: "Limit order filled",
  stop: "Stop order triggered",
  stop_limit: "Stop-limit filled",
};

export function describeAutoExecution(decision: AutoExecutionDecision): string {
  if (decision.trigger === "expiry") return "Day order expired without filling.";

  const price = (decision.price ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 });
  if (decision.trigger === "entry") {
    // Named by type where the app knows it, so the banner and the job log say
    // which kind of order actually fired instead of a generic "entry hit".
    const verb = ENTRY_VERB[decision.orderType ?? ""] ?? "Entry hit";
    return `${verb} at $${price}. Marked as open.`;
  }
  const label = decision.trigger === "stop_loss" ? "Stop loss" : "Take profit";
  return `${label} hit at $${price}. Trade closed.`;
}
