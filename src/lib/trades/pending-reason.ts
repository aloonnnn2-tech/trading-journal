// The Auto-calc panel shows a bare "—" for anything it can't work out yet,
// which reads as broken rather than as waiting. Every one of those values is
// missing for a specific, fixable reason -- almost always a field further up
// the same page that hasn't been filled in -- so say which, instead of
// leaving the user to work out why the app appears to have given up.

export interface PendingInputs {
  entry_price: number | null;
  exit_price: number | null;
  shares: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  risk_amount: number | null;
  status: string;
  /** Whether a commission rule matched this trade -- feeds the commission
   *  and breakeven-price cases, which aren't governed by a numeric guard. */
  hasCommissionRule: boolean;
}

const missing = (value: number | null | undefined): boolean =>
  value == null || !Number.isFinite(Number(value));

/** Joins field names the way a sentence would: "a and b", "a, b and c". */
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function needs(t: PendingInputs, fields: [boolean, string][]): string | undefined {
  const names = fields.filter(([isMissing]) => isMissing).map(([, name]) => name);
  if (names.length === 0) return undefined;
  return `Add ${list(names)}`;
}

function needsPL(t: PendingInputs): string | undefined {
  return needs(t, [
    [missing(t.entry_price), "an entry price"],
    [missing(t.exit_price), "an exit price"],
    [missing(t.shares), "a share count"],
  ]);
}

// True only when exit price is the *sole* P/L input missing -- entry price
// and shares are already filled in, so the trade genuinely just hasn't
// closed yet rather than being incomplete some other way too. Checked
// separately from needsPL() so that an open trade missing entry price or
// shares still gets told so, instead of being told to wait for a close that
// wouldn't fix it.
function onlyAwaitingClose(t: PendingInputs): boolean {
  return !missing(t.entry_price) && !missing(t.shares) && missing(t.exit_price);
}

/**
 * Why a derived value has nothing to show, or undefined when it should have
 * a value. Deliberately mirrors the guards in computeDerivedFields and
 * computeBreakevenPrice -- if either returns null, exactly one of these
 * explains it.
 */
export function pendingReason(
  field:
    | "dollar_pl"
    | "percent_return"
    | "r_multiple"
    | "risk_reward_ratio"
    | "breakeven_price"
    | "commission",
  t: PendingInputs,
): string | undefined {
  const pl = needsPL(t);
  // Shared by every P/L-derived case below: an open trade with entry price
  // and shares already filled in genuinely has no result yet -- telling
  // someone to "add an exit price" to a position they haven't sold would be
  // wrong. Anything else missing (entry price, shares) is still reported,
  // since closing the trade alone wouldn't fix that.
  const plReason = pl && t.status !== "closed" && onlyAwaitingClose(t) ? "Once the trade closes" : pl;

  switch (field) {
    case "dollar_pl":
      return plReason;

    case "percent_return":
      if (plReason) return plReason;
      // The only remaining way this is null: entry x shares came to zero.
      return undefined;

    case "r_multiple":
      if (plReason) return plReason;
      if (missing(t.risk_amount)) return "Add a stop loss, or a risk amount";
      // risk_amount is present but computed to exactly 0 -- a stop loss set
      // equal to entry price. Nothing is "missing" here (0 is a real,
      // present value), so needs()/missing() wouldn't catch this; it's a
      // distinct reason, not an absent field.
      if (t.risk_amount === 0) return "Your stop loss is the same as your entry price";
      return undefined;

    case "risk_reward_ratio": {
      const reason = needs(t, [
        [missing(t.entry_price), "an entry price"],
        [missing(t.stop_loss), "a stop loss"],
        [missing(t.take_profit), "a take profit"],
      ]);
      if (reason) return reason;
      if (t.entry_price === t.stop_loss) return "Your stop loss is the same as your entry price";
      return undefined;
    }

    case "breakeven_price": {
      const reason = needs(t, [
        [missing(t.entry_price), "an entry price"],
        [missing(t.shares), "a share count"],
      ]);
      if (reason) return reason;
      if (t.shares === 0) return "Add a share count";
      // Entry price and a real share count are both here -- if it's still
      // blank, a commission rule is the only other thing computeBreakevenPrice
      // needs, so it's the only other thing worth blaming.
      return t.hasCommissionRule ? undefined : "No matching rule — add one on the Commissions page";
    }

    case "commission":
      if (!t.hasCommissionRule) return "No matching rule — add one on the Commissions page";
      // resolveCommission (calculate.ts) returns null for a pending trade
      // even when a rule matches -- the entry fee isn't charged until the
      // trade actually opens, so there's genuinely nothing to show yet.
      if (t.status === "pending") return "Nothing charged on this trade yet";
      return undefined;
  }
}
