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
// Holds the "never NaN/Infinity" contract above, which the arithmetic here
// could otherwise break: multiplying two *finite* user-supplied numbers can
// still overflow to Infinity, and Infinity then propagates as NaN through the
// division below. Neither survives the trip to the database -- JSON.stringify
// turns both into null -- so an import carrying absurd magnitudes stored a
// silently empty P/L on a row it reported as imported successfully, and
// resultForClosedTrade filed it as break-even. Collapsing to null here makes
// that outcome explicit instead of accidental.
function finite(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function computeDerivedFields(trade: TradeCoreFields): DerivedFields {
  const { entry_price, exit_price, stop_loss, take_profit, shares, risk_amount, direction, commission } =
    trade;
  const sign = direction === "short" ? -1 : 1;
  const fees = commission != null && Number.isFinite(Number(commission)) ? Number(commission) : 0;

  let dollar_pl: number | null = null;
  if (entry_price != null && exit_price != null && shares != null) {
    dollar_pl = (exit_price - entry_price) * shares * sign - fees;
  }

  // Cost basis is a magnitude. A negative share count is not a valid way to
  // express a short -- that is what `direction` is for -- but nothing rejects
  // one, and dividing by a signed basis made the very same trade report a
  // dollar *loss* and a positive percentage *return* at the same time.
  const basis =
    entry_price != null && shares != null ? Math.abs(entry_price * shares) : 0;

  let percent_return: number | null = null;
  if (dollar_pl != null && basis !== 0) {
    percent_return = (dollar_pl / basis) * 100;
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

  return {
    dollar_pl: finite(dollar_pl),
    percent_return: finite(percent_return),
    r_multiple: finite(r_multiple),
    risk_reward_ratio: finite(risk_reward_ratio),
  };
}
