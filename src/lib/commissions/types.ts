export type CommissionRuleType = "flat" | "percent" | "per_unit";
export type CommissionSide = "both" | "entry" | "exit";

export interface CommissionRule {
  id: string;
  user_id: string;
  name: string;
  rule_type: CommissionRuleType;
  /** Dollars for flat/per_unit; a percent (2.5 = 2.5%) for percent. */
  amount: number;
  applies_to: CommissionSide;
  /** null = matches any asset type / market. */
  asset_type: string | null;
  market: string | null;
  min_fee: number | null;
  max_fee: number | null;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /**
   * Several fee lines charged together -- a broker's commission plus the SEC
   * fee plus FINRA's TAF, say (migration 0055). When present and non-empty
   * they REPLACE rule_type/amount/applies_to/min_fee/max_fee, which then only
   * describe older single-line rules. Absent/null: a single-line rule.
   */
  components?: FeeComponent[] | null;
  /** Where a preset's figures came from, and when they were checked (0055). */
  preset_id?: string | null;
}

/**
 * Which fill a fee line is charged on. `entry`/`exit` follow the trade;
 * `buy`/`sell` follow the ORDER, which is what regulators charge by: the SEC
 * fee and FINRA's TAF are on sells, so for a short they land on the entry.
 */
export type FeeSide = "both" | "entry" | "exit" | "buy" | "sell";

/** One line of a multi-line rule. Amounts are per side, like a single-line rule. */
export interface FeeComponent {
  /** What the line is, shown in the breakdown: "Commission", "SEC fee". */
  label: string;
  basis: CommissionRuleType;
  /** Dollars (flat, per_unit) or a percent of trade value (2.5 = 2.5%). */
  amount: number;
  side: FeeSide;
  min_fee?: number | null;
  max_fee?: number | null;
  /** A cap as a percent of the fill's value -- IBKR's "1% of trade value". */
  max_percent?: number | null;
  /**
   * Size bands. When present, `amount` is replaced by the amount of the band
   * the fill falls in -- the band's rate applies to the whole fill, as most
   * banks' "0.1% up to $10,000, 0.05% above" schedules are read.
   */
  tiers?: FeeTier[] | null;
  /** What the bands measure: the fill's value (default) or its share count. */
  tier_by?: "value" | "shares";
  /** Charged only on fills that match. Absent = every fill. */
  only_when?: FeeCondition | null;
  /**
   * The currency the broker states the fee in, and how many account-currency
   * units one of it is worth -- a rate the user fixed when setting it up
   * (fetched live, then stored with its date, so a result never changes
   * because a rate moved later). Absent = the account's own currency.
   */
  currency?: string | null;
  fx_rate?: number | null;
  fx_rate_date?: string | null;
  /**
   * Where the broker takes it from. "shares": out of the position being
   * bought (it raises the effective buy price, e.g. $80 -> $82.50); "cash":
   * from the balance. The P/L is the same either way; this decides how the
   * app describes it.
   */
  taken_from?: "cash" | "shares";
}

/** One size band: up to `up_to` (inclusive; null = no upper limit), charge `amount`. */
export interface FeeTier {
  up_to: number | null;
  amount: number;
}

/** When a fee line applies. Every field given must match. */
export interface FeeCondition {
  /** The trade's order type is one of these (market, limit, stop...). */
  order_types?: string[];
  direction?: "long" | "short";
  /** The fill price is below this -- "stocks under $1". */
  price_below?: number | null;
  /** The fill price is at least this. */
  price_at_least?: number | null;
}

export type CommissionRuleInput = Pick<
  CommissionRule,
  "name" | "rule_type" | "amount" | "applies_to" | "asset_type" | "market" | "min_fee" | "max_fee" | "enabled"
> & { components?: FeeComponent[] | null; preset_id?: string | null };

export const RULE_TYPE_LABELS: Record<CommissionRuleType, string> = {
  flat: "Flat fee per trade",
  percent: "Percent of trade value",
  per_unit: "Per share / contract",
};

export const SIDE_LABELS: Record<CommissionSide, string> = {
  both: "Entry and exit",
  entry: "Entry only",
  exit: "Exit only",
};

export const FEE_SIDE_LABELS: Record<FeeSide, string> = {
  both: "Every fill",
  entry: "Entry only",
  exit: "Exit only",
  buy: "Buys only",
  sell: "Sells only",
};
