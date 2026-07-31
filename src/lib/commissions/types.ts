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
}

export type CommissionRuleInput = Pick<
  CommissionRule,
  "name" | "rule_type" | "amount" | "applies_to" | "asset_type" | "market" | "min_fee" | "max_fee" | "enabled"
>;

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
