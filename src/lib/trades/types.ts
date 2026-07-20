import type { EntityType } from "@/lib/fields/types";

export type TradeStatus = "pending" | "open" | "closed";
export type TradeResult = "open" | "win" | "loss" | "break_even";
export type TradeDirection = "long" | "short";

export interface Trade {
  id: string;
  user_id: string;
  mode: EntityType;

  ticker: string;
  company_name: string | null;
  asset_type: string | null;
  market: string | null;
  direction: TradeDirection | null;

  status: TradeStatus;
  result: TradeResult;

  entry_price: number | null;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  shares: number | null;
  position_size: number | null;
  dollar_amount: number | null;
  risk_amount: number | null;
  risk_percent: number | null;

  entry_date: string | null;
  exit_date: string | null;

  dollar_pl: number | null;
  percent_return: number | null;
  r_multiple: number | null;
  risk_reward_ratio: number | null;

  custom_fields: Record<string, unknown>;
  // Values for strategy-scoped custom fields, namespaced by strategy id:
  // { [strategyId]: { [fieldKey]: value } }.
  strategy_field_values: Record<string, Record<string, unknown>>;

  created_at: string;
  updated_at: string;
}

export type TradeCoreFields = Pick<
  Trade,
  | "entry_price"
  | "exit_price"
  | "stop_loss"
  | "take_profit"
  | "shares"
  | "risk_amount"
  | "direction"
>;

// Columns a client is allowed to PATCH directly. Derived P/L columns are
// server-computed and never accepted from the client.
export const EDITABLE_CORE_FIELDS = [
  "mode",
  "ticker",
  "company_name",
  "asset_type",
  "market",
  "direction",
  "status",
  "result",
  "entry_price",
  "exit_price",
  "stop_loss",
  "take_profit",
  "shares",
  "position_size",
  "dollar_amount",
  "risk_amount",
  "risk_percent",
  "entry_date",
  "exit_date",
] as const;

export type EditableCoreField = (typeof EDITABLE_CORE_FIELDS)[number];

// Core fields a user is allowed to hide from the Trade Card. Ticker,
// Status, and Result are excluded -- they drive auto-bucketing and the
// list view, so they always stay visible.
export const TOGGLEABLE_CORE_FIELDS: { key: EditableCoreField; label: string }[] = [
  { key: "company_name", label: "Company Name" },
  { key: "asset_type", label: "Asset Type" },
  { key: "market", label: "Market" },
  { key: "direction", label: "Direction" },
  { key: "entry_price", label: "Entry Price" },
  { key: "exit_price", label: "Exit Price" },
  { key: "stop_loss", label: "Stop Loss" },
  { key: "take_profit", label: "Take Profit" },
  { key: "shares", label: "Number of Shares" },
  { key: "position_size", label: "Position Size" },
  { key: "dollar_amount", label: "Dollar Amount" },
  { key: "risk_amount", label: "Risk Amount" },
  { key: "risk_percent", label: "Risk %" },
  { key: "entry_date", label: "Entry Date" },
  { key: "exit_date", label: "Exit Date" },
];
