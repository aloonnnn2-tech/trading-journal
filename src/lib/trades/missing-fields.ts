import type { EditableCoreField, Trade } from "./types";

export interface MissingField {
  key: EditableCoreField;
  label: string;
}

// Only the core fields relevant to whether a trade is properly logged --
// deliberately excludes custom_fields/notes (a "field" the user opted into,
// not something to nag about) and take_profit (explicitly optional: not
// every trade has a defined target, unlike stop loss).
const LABELS: Partial<Record<EditableCoreField, string>> = {
  ticker: "Ticker",
  direction: "Direction",
  entry_price: "Entry Price",
  stop_loss: "Stop Loss",
  entry_date: "Entry Date",
  exit_price: "Exit Price",
  exit_date: "Exit Date",
  dollar_amount: "Dollar Amount",
  shares: "Number of Shares",
  position_size: "Position Size",
};

// Entry date is always required, regardless of pending/open/closed status --
// a trade needs a "when" from the moment it's logged, not just once it's
// filled.
const TRADE_REQUIRED: EditableCoreField[] = ["ticker", "direction", "entry_price", "stop_loss", "entry_date"];
// Investment mode hides the entire "Entry information" card (entry/exit
// price, shares, position size, dollar amount, risk fields are all
// `{!isInvestment && ...}` in TradeCard) -- an investment's cost basis and
// share count live in mode-specific *custom* fields instead ("Average
// Cost", "Total Shares", seeded per-user in migration 0002+). Only ticker
// and entry date are actually editable core fields for an investment, so
// those are the only ones worth asking for here; requiring entry_price
// would nag for a field the user has no UI to fill in.
const INVESTMENT_REQUIRED: EditableCoreField[] = ["ticker", "entry_date"];
// A closed trade should have both an exit price and an exit date, on top
// of whatever's already required to open it -- but exit_price is likewise
// not an investment-mode field, so only exit_date applies there.
const CLOSED_REQUIRED: EditableCoreField[] = ["exit_price", "exit_date"];
const INVESTMENT_CLOSED_REQUIRED: EditableCoreField[] = ["exit_date"];
// Position sizing is satisfied by any one of these three -- a user who
// sizes by dollar amount shouldn't be nagged for shares, and vice versa.
// Trade-mode only: like the rest of the Entry information card, none of
// these are investment-mode fields.
const SIZING_FIELDS: EditableCoreField[] = ["shares", "position_size", "dollar_amount"];

/**
 * Core fields still worth filling in, for the "needs attention" checklist
 * on the trade card. Respects hidden-core-field settings (a field the user
 * removed from their card entirely isn't "missing", it's just not shown)
 * and the trade's mode (investments don't use direction/stop-loss/etc).
 */
export function getMissingFields(
  trade: Trade,
  isInvestment: boolean,
  hiddenCoreFields: EditableCoreField[],
): MissingField[] {
  const hidden = new Set(hiddenCoreFields);
  const isEmpty = (key: EditableCoreField): boolean => {
    const value = (trade as unknown as Record<string, unknown>)[key];
    return value === null || value === undefined || value === "";
  };

  const required = [...(isInvestment ? INVESTMENT_REQUIRED : TRADE_REQUIRED)];
  if (trade.status === "closed") {
    required.push(...(isInvestment ? INVESTMENT_CLOSED_REQUIRED : CLOSED_REQUIRED));
  }

  const missing: MissingField[] = [];
  for (const key of required) {
    if (hidden.has(key)) continue;
    if (isEmpty(key)) missing.push({ key, label: LABELS[key] ?? key });
  }

  // Sizing (shares/position size/dollar amount) isn't an investment-mode
  // concept -- that card is hidden entirely for investments.
  const sizingKeys = isInvestment ? [] : SIZING_FIELDS.filter((key) => !hidden.has(key));
  if (sizingKeys.length > 0 && sizingKeys.every((key) => isEmpty(key))) {
    // Whichever sizing field the user hasn't hidden is the one to point
    // them at; if more than one is visible, "Position Size" is the most
    // generic label to suggest first.
    const suggested = sizingKeys.includes("position_size") ? "position_size" : sizingKeys[0];
    missing.push({ key: suggested, label: LABELS[suggested] ?? "Position Size" });
  }

  return missing;
}
