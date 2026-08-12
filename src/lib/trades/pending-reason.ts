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

/**
 * Why a derived value has nothing to show, or undefined when it should have
 * a value. Deliberately mirrors the guards in computeDerivedFields -- if that
 * returns null, exactly one of these explains it.
 */
export function pendingReason(
  field: "dollar_pl" | "percent_return" | "r_multiple" | "risk_reward_ratio",
  t: PendingInputs,
): string | undefined {
  const pl = needs(t, [
    [missing(t.entry_price), "an entry price"],
    [missing(t.exit_price), "an exit price"],
    [missing(t.shares), "a share count"],
  ]);

  switch (field) {
    case "dollar_pl":
      // An open trade isn't missing anything -- there's simply no result yet,
      // and telling someone to "add an exit price" to a position they haven't
      // sold would be wrong.
      if (pl && t.status !== "closed" && missing(t.exit_price)) return "Once the trade closes";
      return pl;

    case "percent_return":
      if (pl) return pl;
      // The only remaining way this is null: entry x shares came to zero.
      return undefined;

    case "r_multiple":
      if (pl) return pl;
      if (missing(t.risk_amount)) return "Add a stop loss, or a risk amount";
      return undefined;

    case "risk_reward_ratio":
      return needs(t, [
        [missing(t.entry_price), "an entry price"],
        [missing(t.stop_loss), "a stop loss"],
        [missing(t.take_profit), "a take profit"],
      ]);
  }
}
