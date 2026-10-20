import type { Trade } from "./types";

// "At what price did it fill?" -- asked on the trade card after a resting
// stop, limit, stop-limit or trailing-stop order fills (Alon, 2026-10-10).
//
// The app has to assume a fill price when an order opens -- the price the
// order was entered at; for a stop-limit, its stop (auto-execute.ts never
// moves it) -- and the entry price drives every P/L and R figure. Migration 0063's trigger marks
// the trade (fill_price_confirmed = false) and keeps the order's own price;
// this decides what to ask and what range a fill normally lands in.
//
// The range is guidance, never a rule: a stop can slip well past its level on
// a gap, and the broker's fill is the truth. So a price outside it is saved
// all the same, with a note.

export type FillCheckTrade = Pick<
  Trade,
  "status" | "order_type" | "direction" | "entry_price" | "limit_price"
> & {
  /** Absent until migration 0063 is applied -- then nothing is ever asked. */
  fill_price_confirmed?: boolean | null;
  order_price?: number | null;
};

export interface FillQuestion {
  /** "Your buy stop-limit order is open." */
  heading: string;
  /** Where this kind of order fills, in words. Null when it can't be said. */
  hint: string | null;
  /** The price the app assumed: the box starts on it. */
  assumed: number | null;
  /** Where a fill normally lands, for the soft check. */
  range: { min?: number; max?: number };
  /** Other prices worth one tap: a stop-limit's limit leg. */
  alternatives: { label: string; price: number }[];
}

const TYPE_NAMES: Record<string, string> = {
  limit: "limit",
  stop: "stop",
  stop_limit: "stop-limit",
  trailing_stop: "trailing stop",
};

export function formatFillPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function fillQuestion(trade: FillCheckTrade): FillQuestion | null {
  if (trade.fill_price_confirmed !== false) return null;
  if (trade.status !== "open" && trade.status !== "closed") return null;
  const type = trade.order_type ?? "";
  if (!TYPE_NAMES[type]) return null;

  // Opening a short is a sell; a long, a buy. Unknown direction: no side.
  const side = trade.direction === "long" ? "buy " : trade.direction === "short" ? "sell " : "";
  const buy = trade.direction === "long";
  const known = trade.direction != null;
  const heading = `Your ${side}${TYPE_NAMES[type]} order ${trade.status === "open" ? "is open" : "filled"}.`;
  const order = trade.order_price ?? null;
  const f = formatFillPrice;

  let hint: string | null = null;
  let range: FillQuestion["range"] = {};

  if (type === "limit") {
    const at = order ?? trade.entry_price;
    if (at != null && known) {
      hint = buy ? `A buy limit fills at ${f(at)} or lower.` : `A sell limit fills at ${f(at)} or higher.`;
      range = buy ? { max: at } : { min: at };
    }
  } else if (type === "stop" || (type === "stop_limit" && trade.limit_price == null)) {
    if (order != null && known) {
      hint = buy
        ? `A buy stop fills at ${f(order)} or higher, and can slip past it on a fast move or a gap.`
        : `A sell stop fills at ${f(order)} or lower, and can slip past it on a fast move or a gap.`;
      range = buy ? { min: order } : { max: order };
    }
  } else if (type === "stop_limit") {
    const limit = trade.limit_price!;
    if (order != null && known) {
      hint = buy
        ? `A buy stop-limit fills between the stop (${f(order)}) and the limit (${f(limit)}).`
        : `A sell stop-limit fills between the limit (${f(limit)}) and the stop (${f(order)}).`;
      range = { min: Math.min(order, limit), max: Math.max(order, limit) };
    }
  } else if (type === "trailing_stop") {
    hint = "A trailing stop fills wherever the trail was hit, so only your broker's fill shows the price.";
  }

  const alternatives =
    type === "stop_limit" && trade.limit_price != null && trade.limit_price !== trade.entry_price
      ? [{ label: "the limit", price: trade.limit_price }]
      : [];
  return { heading, hint, assumed: trade.entry_price, range, alternatives };
}

/** True when a price is outside where this order normally fills. A tolerance
 *  of half a percent covers rounding and a sliver of slippage. */
export function outsideFillRange(price: number, range: FillQuestion["range"]): boolean {
  const slack = Math.abs(price) * 0.005;
  if (range.min != null && price < range.min - slack) return true;
  if (range.max != null && price > range.max + slack) return true;
  return false;
}
