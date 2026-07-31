import type { TradeCoreFields } from "./types";

export interface DerivedFields {
  dollar_pl: number | null;
  percent_return: number | null;
  r_multiple: number | null;
  risk_reward_ratio: number | null;
}

// Pure function: never returns NaN/Infinity, only a number or null when a
// value isn't computable yet (e.g. trade still open, no exit price).
//
// dollar_pl is NET of commission, not gross. That's deliberate and is what
// keeps the rest of the app correct for free: every aggregate in this
// codebase (dashboard, analytics, insights, ask, strategy/emotion
// breakdowns, the account-cash balance, and the dashboard_stats RPC) sums
// or thresholds this one column, so storing the number that actually hit
// the account means none of them need to know commissions exist. It also
// makes `dollar_pl > 0` -- which is how every win-rate in the app is
// defined -- mean "actually made money", rather than "made money before
// the broker took its cut".
export function computeDerivedFields(trade: TradeCoreFields): DerivedFields {
  const { entry_price, exit_price, stop_loss, take_profit, shares, risk_amount, direction, commission } =
    trade;
  const sign = direction === "short" ? -1 : 1;
  const fees = commission != null && Number.isFinite(Number(commission)) ? Number(commission) : 0;

  let dollar_pl: number | null = null;
  if (entry_price != null && exit_price != null && shares != null) {
    dollar_pl = (exit_price - entry_price) * shares * sign - fees;
  }

  let percent_return: number | null = null;
  if (dollar_pl != null && entry_price != null && shares != null && entry_price * shares !== 0) {
    percent_return = (dollar_pl / (entry_price * shares)) * 100;
  }

  let r_multiple: number | null = null;
  if (dollar_pl != null && risk_amount != null && risk_amount !== 0) {
    r_multiple = dollar_pl / risk_amount;
  }

  // Deliberately gross: this is the *planned* ratio between the price levels
  // the user chose, which is what makes it comparable across trades of
  // different sizes. Netting fees into it would make the same setup score
  // differently on 1 share vs 1000. The commission-aware counterpart is the
  // break-even price (see lib/commissions/calculate.ts), shown next to it.
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
