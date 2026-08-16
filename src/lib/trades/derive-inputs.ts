import type { EditableCoreField } from "./types";

// The money fields on a trade aren't really independent: the dollar amount
// is entry price x shares, the risk amount is what the stop distance costs
// you across those shares, and risk % is that against the account. The
// Quick Trade dialog has always kept the first three in step while you type
// (see QuickTradeButton), but the trade page didn't -- every field there was
// its own box you had to fill in by hand, so they mostly stayed empty.
//
// That's worse than untidy: r_multiple is dollar_pl / risk_amount, so a
// blank risk amount means no R multiple on the trade, and nothing in the
// R-multiple histogram on the analytics page.
//
// Pure and edit-driven: given the field just edited and the trade's values
// after that edit, return the other fields that should follow. Deriving on
// edit rather than on load is deliberate -- opening an old trade shouldn't
// silently rewrite it.

export interface MoneyFields {
  entry_price: number | null;
  shares: number | null;
  dollar_amount: number | null;
  stop_loss: number | null;
  risk_amount: number | null;
}

export type DerivedMoneyFields = Partial<Record<EditableCoreField, number | null>>;

const num = (value: number | null | undefined): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Fields that, when edited, can drive one of the others. */
const TRIGGERS = new Set<EditableCoreField>([
  "entry_price",
  "shares",
  "dollar_amount",
  "stop_loss",
  "risk_amount",
]);

export function deriveMoneyFields(
  edited: EditableCoreField,
  fields: MoneyFields,
  accountBalance: number | null,
): DerivedMoneyFields {
  if (!TRIGGERS.has(edited)) return {};

  const entry = num(fields.entry_price);
  const shares = num(fields.shares);
  const amount = num(fields.dollar_amount);
  const stop = num(fields.stop_loss);

  const derived: DerivedMoneyFields = {};

  // Size: editing the dollar amount solves for shares; editing entry price
  // or shares solves for the dollar amount -- and editing entry price
  // specifically also falls back to solving for *shares* when a dollar
  // amount was already typed in but shares wasn't (e.g. "I'm putting $500
  // into this" before a price is known). Matches QuickTradeButton's
  // handleEntryPriceChange/handleSharesChange field-for-field, including its
  // one asymmetry: an entry price of exactly 0 is treated as not-really-a-
  // price-yet and skips deriving anything, the same way the dialog's guard
  // (`price === 0` → return early) does; editing shares has no equivalent
  // skip in the dialog, so there isn't one here either.
  if (edited === "dollar_amount") {
    if (amount != null && entry != null && entry !== 0) {
      derived.shares = round(amount / entry, 4);
    }
  } else if (edited === "entry_price" && entry !== 0) {
    if (entry != null && shares != null) {
      derived.dollar_amount = round(entry * shares, 2);
    } else if (entry != null && amount != null) {
      derived.shares = round(amount / entry, 4);
    }
  } else if (edited === "shares" && entry != null && shares != null) {
    // Strictly the two fields it's a product of. Recomputing it for every
    // trigger meant editing a stop loss rewrote a dollar amount the user had
    // typed themselves -- entering 1005 to account for fees and then setting
    // a stop silently rounded it back to entry x shares.
    derived.dollar_amount = round(entry * shares, 2);
  }

  // Risk: what the stop costs across the position. Only ever written when
  // all three inputs are there, so this can't blank out a figure the user
  // typed themselves -- and if they do overtype it, it stands until one of
  // entry/stop/shares moves again.
  const sharesForRisk = edited === "dollar_amount" ? (derived.shares ?? shares) : shares;
  let risk = num(fields.risk_amount);
  if (edited !== "risk_amount" && entry != null && stop != null && sharesForRisk != null) {
    risk = round(Math.abs(entry - stop) * sharesForRisk, 2);
    derived.risk_amount = risk;
  }

  // Risk as a share of the account. Needs a funded account to mean anything;
  // without one the field is left alone rather than filled with a nonsense
  // percentage.
  if (risk != null && accountBalance != null && accountBalance > 0) {
    derived.risk_percent = round((risk / accountBalance) * 100, 2);
  }

  return derived;
}

/**
 * Runs deriveMoneyFields once per money-field trigger in a batch of edits
 * applied all at once -- unlike a normal one-field-at-a-time edit, OCR's
 * "apply detected fields" (and any similar bulk-apply path) can set several
 * money fields in a single action. Each trigger in the batch sees the
 * previous ones' results, the same as if they'd been typed in one at a
 * time. Never derives a value for a field that was *also* explicitly
 * provided in the same batch -- e.g. OCR detecting a dollar amount
 * directly shouldn't have an entry-price x shares derivation silently
 * overwrite it.
 */
export function deriveBatchedMoneyFields(
  edits: [EditableCoreField, unknown][],
  fields: MoneyFields,
  accountBalance: number | null,
): DerivedMoneyFields {
  const explicitKeys = new Set(edits.map(([key]) => key));
  let after: MoneyFields = { ...fields };
  for (const [key, value] of edits) {
    if (key in after) after = { ...after, [key]: value };
  }

  const result: DerivedMoneyFields = {};
  for (const [key] of edits) {
    const derived = deriveMoneyFields(key, after, accountBalance);
    for (const [field, derivedValue] of Object.entries(derived)) {
      if (explicitKeys.has(field as EditableCoreField)) continue;
      result[field as EditableCoreField] = derivedValue;
      after = { ...after, [field]: derivedValue };
    }
  }
  return result;
}
