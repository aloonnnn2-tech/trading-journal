import type { TradeCoreFields } from "./types";

export interface DerivedFields {
  dollar_pl: number | null;
  percent_return: number | null;
  r_multiple: number | null;
  risk_reward_ratio: number | null;
}

// Pure function: never returns NaN/Infinity, only a number or null when a
// value isn't computable yet (e.g. trade still open, no exit price).
export function computeDerivedFields(trade: TradeCoreFields): DerivedFields {
  const { entry_price, exit_price, stop_loss, take_profit, shares, risk_amount, direction } =
    trade;
  const sign = direction === "short" ? -1 : 1;

  let dollar_pl: number | null = null;
  if (entry_price != null && exit_price != null && shares != null) {
    dollar_pl = (exit_price - entry_price) * shares * sign;
  }

  let percent_return: number | null = null;
  if (dollar_pl != null && entry_price != null && shares != null && entry_price * shares !== 0) {
    percent_return = (dollar_pl / (entry_price * shares)) * 100;
  }

  let r_multiple: number | null = null;
  if (dollar_pl != null && risk_amount != null && risk_amount !== 0) {
    r_multiple = dollar_pl / risk_amount;
  }

  let risk_reward_ratio: number | null = null;
  if (entry_price != null && stop_loss != null && take_profit != null) {
    const reward = Math.abs(take_profit - entry_price);
    const risk = Math.abs(entry_price - stop_loss);
    if (risk !== 0) {
      risk_reward_ratio = reward / risk;
    }
  }

  return { dollar_pl, percent_return, r_multiple, risk_reward_ratio };
}
