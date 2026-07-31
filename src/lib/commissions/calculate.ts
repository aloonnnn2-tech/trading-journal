import type { CommissionRule } from "./types";

export interface CommissionTradeInput {
  /** "investment" is never charged -- see resolveCommission. */
  mode?: string | null;
  asset_type: string | null;
  market: string | null;
  status: string;
  direction: string | null;
  entry_price: number | null;
  exit_price: number | null;
  shares: number | null;
}

export interface CommissionBreakdown {
  /** Fee charged to open the position (0 until the trade is actually open). */
  entryFee: number;
  /** Fee charged to close it (0 until the trade is closed). */
  exitFee: number;
  /** entryFee + exitFee -- what to store on trades.commission. */
  total: number;
}

const norm = (value: string | null): string => (value ?? "").trim().toLowerCase();

/**
 * First enabled rule whose scoping matches this trade, by sort_order. A rule
 * with a null asset_type/market matches anything, so a specific "crypto" rule
 * placed above a catch-all wins for crypto trades and the catch-all still
 * covers everything else.
 */
export function matchCommissionRule(
  rules: CommissionRule[],
  trade: Pick<CommissionTradeInput, "asset_type" | "market">,
): CommissionRule | null {
  const assetType = norm(trade.asset_type);
  const market = norm(trade.market);

  const matches = rules
    .filter((rule) => rule.enabled)
    .filter((rule) => {
      if (rule.asset_type != null && norm(rule.asset_type) !== assetType) return false;
      if (rule.market != null && norm(rule.market) !== market) return false;
      return true;
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));

  return matches[0] ?? null;
}

/** Clamp one side's fee to the rule's optional floor/cap. */
function clampFee(rule: CommissionRule, fee: number): number {
  let result = fee;
  if (rule.min_fee != null && Number.isFinite(rule.min_fee)) result = Math.max(result, Number(rule.min_fee));
  if (rule.max_fee != null && Number.isFinite(rule.max_fee)) result = Math.min(result, Number(rule.max_fee));
  return Math.max(result, 0);
}

/**
 * Fee for a single side (one fill) at `price` for `shares` units. Returns 0
 * when the rule doesn't bill that side, or when the inputs it needs are
 * missing -- an unknown fee is reported as 0 rather than guessed, matching
 * how the rest of this app treats un-computable numbers.
 */
export function sideFee(
  rule: CommissionRule,
  side: "entry" | "exit",
  price: number | null,
  shares: number | null,
): number {
  if (rule.applies_to !== "both" && rule.applies_to !== side) return 0;

  const amount = Number(rule.amount);
  if (!Number.isFinite(amount)) return 0;

  switch (rule.rule_type) {
    case "flat":
      return clampFee(rule, amount);
    case "per_unit": {
      if (shares == null || !Number.isFinite(shares)) return 0;
      return clampFee(rule, amount * Math.abs(shares));
    }
    case "percent": {
      if (price == null || shares == null || !Number.isFinite(price) || !Number.isFinite(shares)) return 0;
      return clampFee(rule, (amount / 100) * Math.abs(price * shares));
    }
    default:
      return 0;
  }
}

/**
 * Fees actually incurred so far. A pending order hasn't filled, so it owes
 * nothing; an open position has paid to enter; a closed one has paid both
 * sides. This is what gets stored on trades.commission and subtracted from
 * dollar_pl -- deliberately *not* the projected round trip, so an open
 * trade's P&L isn't docked for an exit fee it hasn't paid yet.
 */
export function computeCommission(
  rule: CommissionRule | null,
  trade: CommissionTradeInput,
): CommissionBreakdown {
  const none = { entryFee: 0, exitFee: 0, total: 0 };
  if (!rule) return none;
  if (trade.status === "pending") return none;

  const entryFee = sideFee(rule, "entry", trade.entry_price, trade.shares);
  const exitFee = trade.status === "closed" ? sideFee(rule, "exit", trade.exit_price, trade.shares) : 0;

  return { entryFee, exitFee, total: entryFee + exitFee };
}

/**
 * What to store on trades.commission: the single entry point every write
 * path goes through (updateTrade, both import routes), so the rules for
 * *whether* a trade is charged at all live in exactly one place.
 *
 * Returns null -- meaning "no fee recorded" -- rather than 0 in the three
 * cases where a fee was never assessed, so the UI can show "—" instead of a
 * "$0.00" that reads like a calculated result:
 *   - investment-mode trades, which have no entry/exit price or share count
 *     to charge against (that whole card is hidden in TradeCard) and are
 *     excluded from commissions by design;
 *   - pending orders, which haven't filled, so nothing has been paid;
 *   - trades no enabled rule matches.
 */
export function resolveCommission(
  rules: CommissionRule[],
  trade: CommissionTradeInput,
): number | null {
  if (trade.mode === "investment") return null;
  if (trade.status === "pending") return null;
  const rule = matchCommissionRule(rules, trade);
  if (!rule) return null;
  return computeCommission(rule, trade).total;
}

/**
 * The price at which the position actually breaks even once the *full round
 * trip* of fees is paid -- including the exit fee not yet incurred. Buy 1
 * share at $90 with a $2.50-per-side rule and this returns $95: the price
 * has to cover both fees before the trade is genuinely profitable, which is
 * the whole point of showing it on the chart next to the entry line.
 *
 * Solved by fixed-point iteration rather than a closed form because a
 * percent-based exit fee depends on the very price being solved for, and
 * min/max clamping makes the closed form piecewise. The iteration is a
 * contraction (its derivative is the fee rate, typically <1%), so it
 * converges to machine precision in a handful of passes; 40 is far beyond
 * what's needed and still costs nothing.
 */
export function computeBreakevenPrice(
  rule: CommissionRule | null,
  trade: CommissionTradeInput,
): number | null {
  if (!rule) return null;
  const { entry_price: entry, shares } = trade;
  if (entry == null || shares == null) return null;
  if (!Number.isFinite(entry) || !Number.isFinite(shares) || shares === 0) return null;

  const isShort = trade.direction === "short";
  const absShares = Math.abs(shares);
  const entryFee = sideFee(rule, "entry", entry, shares);

  let breakeven = entry;
  for (let i = 0; i < 40; i++) {
    const exitFee = sideFee(rule, "exit", breakeven, shares);
    const shift = (entryFee + exitFee) / absShares;
    const next = isShort ? entry - shift : entry + shift;
    if (Math.abs(next - breakeven) < 1e-10) {
      breakeven = next;
      break;
    }
    breakeven = next;
  }

  // A short whose fees exceed the entire position value has no reachable
  // break-even (price can't go below zero), and any non-finite result means
  // the iteration diverged on absurd inputs -- report "unknown" rather than
  // drawing a nonsense line on the chart.
  if (!Number.isFinite(breakeven) || breakeven <= 0) return null;
  return breakeven;
}
