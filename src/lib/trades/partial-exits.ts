import { z } from "zod";
import type { PartialExit, PartialExitReason, Trade, TradeDirection } from "./types";

// Partial sells (0079): part of an open position sold before the rest. One
// list per trade, oldest first. The rest is closed the usual way
// (exit_price/exit_date), so a trade with no sales behaves exactly as before.
//
// This module is the one place that knows the shape: the route validates
// through it, computeDerivedFields and the fee rules read through
// `readPartialExits`, and the AI review and Ask describe sales with
// `describePartialExits`.

export const PARTIAL_EXIT_REASONS: { value: PartialExitReason; label: string }[] = [
  { value: "earnings", label: "Earnings coming up" },
  { value: "reduce_risk", label: "Reduce risk" },
  { value: "partial_profit", label: "Took partial profit" },
  { value: "target", label: "Hit a target" },
  { value: "other", label: "Other" },
];

export const MAX_PARTIAL_EXITS = 50;
export const MAX_PARTIAL_EXIT_NOTE = 500;

export function partialExitReasonLabel(reason: PartialExitReason): string {
  return PARTIAL_EXIT_REASONS.find((r) => r.value === reason)?.label ?? "Other";
}

const positiveAmount = z
  .number()
  .finite()
  .positive()
  .refine((n) => n <= Number.MAX_SAFE_INTEGER, { message: "number is too large to store accurately" });

const saleDate = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "must be a valid date" });

/** One sale as the "Sell part" form sends it. The server makes the id. */
export const partialExitInputSchema = z
  .object({
    date: saleDate,
    shares: positiveAmount,
    price: positiveAmount,
    reason: z.enum(["earnings", "reduce_risk", "partial_profit", "target", "other"]),
    note: z
      .string()
      .max(MAX_PARTIAL_EXIT_NOTE)
      // Same rule as the ticker: no control characters in text that reaches
      // AI prompts. Newlines and tabs are fine in a note.
      .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), "The note can't contain that character.")
      .nullable()
      .optional(),
    fee: z
      .number()
      .finite()
      .min(0)
      .refine((n) => n <= Number.MAX_SAFE_INTEGER, { message: "number is too large to store accurately" })
      .nullable()
      .optional(),
  })
  .strict();

export type PartialExitInput = z.infer<typeof partialExitInputSchema>;

const storedSchema = partialExitInputSchema.extend({ id: z.string().min(1).max(64) });

/**
 * The trade's sales, ready to use. Whatever the column holds, this returns
 * only well-formed sales, oldest first -- a row from before 0079 (absent),
 * null, or a hand-edited value never breaks a P&L calculation.
 */
export function readPartialExits(raw: unknown): PartialExit[] {
  if (!Array.isArray(raw)) return [];
  const sales: PartialExit[] = [];
  for (const item of raw) {
    const parsed = storedSchema.safeParse(item);
    if (parsed.success) sales.push(parsed.data as PartialExit);
  }
  return sortSales(sales);
}

export function sortSales(sales: PartialExit[]): PartialExit[] {
  return [...sales].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** Gross profit of one sale: before its fee. */
export function salePl(
  sale: Pick<PartialExit, "price" | "shares">,
  entryPrice: number,
  direction: TradeDirection | null,
): number {
  const sign = direction === "short" ? -1 : 1;
  return (sale.price - entryPrice) * sale.shares * sign;
}

export interface PartialExitSummary {
  sales: PartialExit[];
  soldShares: number;
  /** Shares still held (or still short). Null when the trade has no size. */
  remainingShares: number | null;
  /** Sum of every sale's gross profit; null without an entry price. */
  realizedGross: number | null;
  /** Average price the sold shares went for. Null with no sales. */
  averageSalePrice: number | null;
}

export function summarizePartialExits(
  trade: Pick<Trade, "entry_price" | "shares" | "direction"> & { partial_exits?: unknown },
): PartialExitSummary {
  const sales = readPartialExits(trade.partial_exits);
  const soldShares = sales.reduce((sum, s) => sum + s.shares, 0);
  const shares = trade.shares != null ? Math.abs(Number(trade.shares)) : null;
  const entry = trade.entry_price;
  return {
    sales,
    soldShares,
    remainingShares: shares != null ? round(shares - soldShares) : null,
    realizedGross:
      entry != null && sales.length > 0
        ? sales.reduce((sum, s) => sum + salePl(s, entry, trade.direction), 0)
        : sales.length > 0
          ? null
          : 0,
    averageSalePrice:
      soldShares > 0 ? sales.reduce((sum, s) => sum + s.price * s.shares, 0) / soldShares : null,
  };
}

// Share counts can be fractional (crypto, fractional shares); sums of
// decimals drift (0.1 + 0.2), and "0.30000000000000004 left" must read 0.3.
function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

/**
 * Why `sales` can't stand on `trade`, or null when they can. The checks the
 * database can't make: you can't sell what you don't hold, and a sale
 * happens while the position is open.
 */
export function partialExitsProblem(
  trade: Pick<Trade, "status" | "mode" | "entry_price" | "shares" | "entry_date" | "exit_date">,
  sales: PartialExit[],
): string | null {
  if (sales.length === 0) return null;
  if (trade.mode === "investment") return "Partial sells are for trades, not investments.";
  if (trade.status !== "open" && trade.status !== "closed") {
    return "You can only sell part of a trade once it's open.";
  }
  if (sales.length > MAX_PARTIAL_EXITS) return `A trade can have at most ${MAX_PARTIAL_EXITS} partial sells.`;
  if (trade.entry_price == null) return "Add the entry price first.";
  if (trade.shares == null || Math.abs(trade.shares) <= 0) return "Add the number of shares first.";

  const held = Math.abs(trade.shares);
  const sold = round(sales.reduce((sum, s) => sum + s.shares, 0));
  if (sold >= held) {
    return trade.status === "closed"
      ? `The sales add up to ${fmtShares(sold)} of your ${fmtShares(held)} shares. Leave some for the final exit.`
      : `You hold ${fmtShares(held)} shares. To sell all of what's left, close the trade instead.`;
  }

  const entryDay = trade.entry_date ? dayOf(trade.entry_date) : null;
  const exitDay = trade.exit_date ? dayOf(trade.exit_date) : null;
  // A day of slack for time zones: dates are compared by calendar day in UTC.
  const tomorrow = dayOf(new Date(Date.now() + 86_400_000).toISOString());
  for (const sale of sales) {
    const day = dayOf(sale.date);
    if (entryDay && day < entryDay) return "A sale can't be dated before the trade's entry.";
    if (trade.status === "closed" && exitDay && day > exitDay) {
      return "A sale can't be dated after the trade's exit.";
    }
    if (day > tomorrow) return "A sale can't be dated in the future.";
  }
  return null;
}

function dayOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function fmtShares(n: number): string {
  return Number.isInteger(n) ? String(n) : String(round(n));
}

/**
 * The sales in words, for the AI trade review and Ask. Every figure is
 * computed here so the model never has to do the maths.
 */
export function describePartialExits(
  trade: Pick<Trade, "entry_price" | "shares" | "direction" | "status" | "exit_price"> & {
    partial_exits?: unknown;
  },
): string[] {
  const summary = summarizePartialExits(trade);
  if (summary.sales.length === 0) return [];
  const entry = trade.entry_price;
  const held = trade.shares != null ? Math.abs(trade.shares) : null;
  const verb = trade.direction === "short" ? "Bought back" : "Sold";
  let left = held;
  const lines = summary.sales.map((sale, i) => {
    left = left != null ? round(left - sale.shares) : null;
    const pl = entry != null ? salePl(sale, entry, trade.direction) : null;
    const parts = [
      `${i + 1}. ${sale.date.slice(0, 10)}: ${verb.toLowerCase()} ${fmtShares(sale.shares)} at ${sale.price}`,
      pl != null ? `P&L ${money(pl)} before fees` : null,
      `reason: ${partialExitReasonLabel(sale.reason)}`,
      sale.note ? `note: "${sale.note.replace(/\s+/g, " ").trim()}"` : null,
      left != null ? `${fmtShares(left)} left after it` : null,
    ].filter(Boolean);
    return parts.join("; ");
  });
  const header =
    `Partial sells: ${summary.sales.length}, ${fmtShares(summary.soldShares)} of ${held != null ? fmtShares(held) : "?"} shares` +
    (summary.realizedGross != null ? `, realized ${money(summary.realizedGross)} before fees` : "") +
    (summary.averageSalePrice != null ? `, average sale price ${round(summary.averageSalePrice)}` : "");
  const tail =
    trade.status === "closed" && trade.exit_price != null && summary.remainingShares != null
      ? [`The remaining ${fmtShares(summary.remainingShares)} shares were closed at ${trade.exit_price} (the exit price).`]
      : summary.remainingShares != null
        ? [`Still holding ${fmtShares(summary.remainingShares)} shares.`]
        : [];
  return [header, ...lines, ...tail];
}

function money(n: number): string {
  const sign = n < 0 ? "-" : "+";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
