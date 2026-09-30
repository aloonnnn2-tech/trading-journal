import { computeBreakevenPrice, computeCommission, computeEntryCoverPrice } from "./calculate";
import type { CommissionRule, CommissionRuleType, FeeComponent, FeeSide } from "./types";

// The Commissions page's form, in the words a trader uses -- and the
// translation between it and a stored rule. Pure, so it is tested directly.
//
// A form is one or more charges. The first (or, when buying and selling are
// charged differently, the first two) are "the fee"; the rest are "other
// charges" (regulator or currency fees). One plain charge saves as an old
// single-line rule, which works before migration 0055; anything richer --
// several charges, buy/sell, tiers, conditions, a currency -- saves as
// `components`.

export interface TierForm {
  up_to: string;
  amount: string;
}

export interface ChargeForm {
  label: string;
  basis: CommissionRuleType;
  amount: string;
  side: FeeSide;
  min_fee: string;
  max_fee: string;
  max_percent: string;
  /** Size bands; empty = one amount for every size. */
  tiers: TierForm[];
  tier_by: "value" | "shares";
  /** "Only when": order types (empty = any), direction ("" = any), a price ceiling. */
  cond_order_types: string[];
  cond_direction: "" | "long" | "short";
  cond_price_below: string;
  /** "" = the account's own currency. */
  currency: string;
  fx_rate: string;
  fx_rate_date: string;
  taken_from: "cash" | "shares";
}

export interface FeeForm {
  name: string;
  /** True once the user types a name: stop filling it in from the answers. */
  nameTouched: boolean;
  asset_type: string;
  market: string;
  charges: ChargeForm[];
  preset_id: string | null;
}

export const BLANK_CHARGE: ChargeForm = {
  label: "Commission",
  basis: "flat",
  amount: "",
  side: "both",
  min_fee: "",
  max_fee: "",
  max_percent: "",
  tiers: [],
  tier_by: "value",
  cond_order_types: [],
  cond_direction: "",
  cond_price_below: "",
  currency: "",
  fx_rate: "",
  fx_rate_date: "",
  taken_from: "cash",
};

export const BLANK_FORM: FeeForm = {
  name: "",
  nameTouched: false,
  asset_type: "",
  market: "",
  charges: [BLANK_CHARGE],
  preset_id: null,
};

/** When a charge applies, in plain words -- used by the form and the list. */
export const WHEN_LABELS: Record<FeeSide, string> = {
  both: "On every buy and sell",
  entry: "Only when I open a trade",
  exit: "Only when I close a trade",
  buy: "Only on buys",
  sell: "Only on sells",
};

/** Order types a condition can name -- the trade card's own list. */
export const ORDER_TYPES = ["market", "limit", "stop", "stop_limit", "trailing_stop"] as const;
export const ORDER_TYPE_LABELS: Record<string, string> = {
  market: "Market",
  limit: "Limit",
  stop: "Stop",
  stop_limit: "Stop limit",
  trailing_stop: "Trailing stop",
};

/** Currencies a fee can be stated in. The account's own is USD. */
export const CURRENCIES = ["EUR", "GBP", "ILS", "CAD", "CHF", "AUD", "JPY"] as const;
export const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
  CAD: "C$",
  CHF: "CHF ",
  AUD: "A$",
  JPY: "¥",
};

const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function chargeFromComponent(c: FeeComponent): ChargeForm {
  return {
    ...BLANK_CHARGE,
    label: c.label,
    basis: c.basis,
    amount: c.amount === 0 ? "" : String(c.amount),
    side: c.side,
    min_fee: str(c.min_fee),
    max_fee: str(c.max_fee),
    max_percent: str(c.max_percent),
    tiers: (c.tiers ?? []).map((t) => ({ up_to: str(t.up_to), amount: String(t.amount) })),
    tier_by: c.tier_by ?? "value",
    cond_order_types: c.only_when?.order_types ?? [],
    cond_direction: c.only_when?.direction ?? "",
    cond_price_below: str(c.only_when?.price_below),
    currency: c.currency ?? "",
    fx_rate: str(c.fx_rate),
    fx_rate_date: c.fx_rate_date ?? "",
    taken_from: c.taken_from ?? "cash",
  };
}

export function formFromRule(rule: CommissionRule): FeeForm {
  const charges =
    rule.components && rule.components.length > 0
      ? rule.components.map(chargeFromComponent)
      : [
          {
            ...BLANK_CHARGE,
            basis: rule.rule_type,
            amount: String(rule.amount),
            side: rule.applies_to,
            min_fee: str(rule.min_fee),
            max_fee: str(rule.max_fee),
          },
        ];
  return {
    name: rule.name,
    nameTouched: true,
    asset_type: rule.asset_type ?? "",
    market: rule.market ?? "",
    charges,
    preset_id: rule.preset_id ?? null,
  };
}

export function formFromComponents(
  components: FeeComponent[],
  extra: Partial<Pick<FeeForm, "name" | "asset_type" | "preset_id">> = {},
): FeeForm {
  return {
    ...BLANK_FORM,
    charges: components.map(chargeFromComponent),
    name: extra.name ?? "",
    nameTouched: !!extra.name,
    asset_type: extra.asset_type ?? "",
    preset_id: extra.preset_id ?? null,
  };
}

function hasExtras(c: ChargeForm): boolean {
  return (
    c.max_percent.trim() !== "" ||
    c.tiers.length > 0 ||
    c.cond_order_types.length > 0 ||
    c.cond_direction !== "" ||
    c.cond_price_below.trim() !== "" ||
    c.currency !== "" ||
    c.taken_from !== "cash"
  );
}

function toComponent(c: ChargeForm): FeeComponent {
  const out: FeeComponent = {
    label: c.label.trim() || "Fee",
    basis: c.basis,
    amount: Number(c.amount || 0),
    side: c.side,
    min_fee: num(c.min_fee),
    max_fee: num(c.max_fee),
    max_percent: num(c.max_percent),
  };
  const tiers = c.tiers
    .filter((t) => t.amount.trim() !== "")
    .map((t) => ({ up_to: num(t.up_to), amount: Number(t.amount) }));
  if (tiers.length > 0) {
    out.tiers = tiers;
    out.tier_by = c.tier_by;
  }
  const when: NonNullable<FeeComponent["only_when"]> = {};
  if (c.cond_order_types.length > 0) when.order_types = c.cond_order_types;
  if (c.cond_direction) when.direction = c.cond_direction;
  if (c.cond_price_below.trim() !== "") when.price_below = Number(c.cond_price_below);
  if (Object.keys(when).length > 0) out.only_when = when;
  if (c.currency) {
    out.currency = c.currency;
    out.fx_rate = num(c.fx_rate);
    out.fx_rate_date = c.fx_rate_date || null;
  }
  if (c.taken_from === "shares") out.taken_from = "shares";
  return out;
}

/** The API payload for a form. */
export function payloadFromForm(form: FeeForm, enabled: boolean) {
  const base = {
    name: (form.name.trim() || suggestName(form)).slice(0, 80),
    asset_type: form.asset_type.trim() || null,
    market: form.market.trim() || null,
    enabled,
    preset_id: form.preset_id,
  };
  const [only] = form.charges;
  const plain =
    form.charges.length === 0 ||
    (form.charges.length === 1 && (only.side === "both" || only.side === "entry" || only.side === "exit") && !hasExtras(only));
  if (plain) {
    return {
      ...base,
      rule_type: only?.basis ?? ("flat" as CommissionRuleType),
      amount: Number(only?.amount || 0),
      applies_to: (only?.side ?? "both") as "both" | "entry" | "exit",
      min_fee: only ? num(only.min_fee) : null,
      max_fee: only ? num(only.max_fee) : null,
      components: null,
    };
  }
  return {
    ...base,
    rule_type: "flat" as CommissionRuleType,
    amount: 0,
    applies_to: "both" as const,
    min_fee: null,
    max_fee: null,
    components: form.charges.map(toComponent),
  };
}

// ---- Buying and selling charged differently ------------------------------

/** Whether the form's fee is two charges, one on buys and one on sells. */
export function isSplit(form: FeeForm): boolean {
  return form.charges[0]?.side === "buy" && form.charges[1]?.side === "sell";
}

/** Same fee both ways -> separate buy and sell charges (the sell one a copy to edit). */
export function splitForm(form: FeeForm): FeeForm {
  if (isSplit(form)) return form;
  const main = form.charges[0] ?? BLANK_CHARGE;
  return {
    ...form,
    charges: [
      { ...main, label: "Buy fee", side: "buy" },
      { ...main, label: "Sell fee", side: "sell", taken_from: "cash" },
      ...form.charges.slice(1),
    ],
  };
}

/** Separate buy and sell charges -> one charge on `side` (keeping the buy one's settings). */
export function unsplitForm(form: FeeForm, side: FeeSide): FeeForm {
  if (!isSplit(form)) {
    return { ...form, charges: form.charges.map((c, i) => (i === 0 ? { ...c, side } : c)) };
  }
  return { ...form, charges: [{ ...form.charges[0], label: "Commission", side }, ...form.charges.slice(2)] };
}

/** A rule object for the live calculator, built from what's typed so far. */
export function previewRule(form: FeeForm): CommissionRule {
  const p = payloadFromForm(form, true);
  return {
    id: "preview",
    user_id: "",
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...p,
    components: p.components ?? null,
  };
}

function money(n: number, currency = "USD"): string {
  // FINRA's TAF is $0.000195 a share; rounding it to $0.0002 would misstate it.
  const abs = Math.abs(n);
  const decimals = abs === 0 ? 2 : abs < 0.01 ? 6 : abs < 0.1 ? 4 : 2;
  const body = n.toFixed(decimals).replace(/(\.\d\d\d*?)0+$/, "$1");
  return `${CURRENCY_SYMBOL[currency] ?? `${currency} `}${body}`;
}

/** One charge as a phrase: "$2.50", "€2 a share", "0.1% of the trade". */
export function describeAmount(c: Pick<FeeComponent, "basis" | "amount" | "currency">): string {
  if (c.basis === "percent") return `${c.amount}% of the trade`;
  const m = money(Number(c.amount), c.currency ?? "USD");
  return c.basis === "per_unit" ? `${m} a share` : m;
}

function describeLimits(c: FeeComponent): string {
  const cur = c.currency ?? "USD";
  const parts = [
    c.min_fee != null ? `at least ${money(c.min_fee, cur)}` : null,
    c.max_fee != null ? `at most ${money(c.max_fee, cur)}` : null,
    c.max_percent != null ? `at most ${c.max_percent}% of the trade` : null,
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function describeTiers(c: FeeComponent): string {
  if (!c.tiers || c.tiers.length === 0) return "";
  const unit = c.tier_by === "shares" ? " shares" : "";
  const sorted = [...c.tiers].sort((a, b) => (a.up_to ?? Infinity) - (b.up_to ?? Infinity));
  const cur = c.currency ?? "USD";
  const band = (t: { up_to: number | null; amount: number }) => {
    const amt = describeAmount({ basis: c.basis, amount: t.amount, currency: c.currency });
    if (t.up_to == null) return `${amt} above`;
    const lim = c.tier_by === "shares" ? `${t.up_to}${unit}` : money(t.up_to, cur);
    return `${amt} up to ${lim}`;
  };
  return sorted.map(band).join(", ");
}

function describeCondition(c: FeeComponent): string {
  const w = c.only_when;
  if (!w) return "";
  const parts = [
    w.order_types?.length ? `${w.order_types.map((o) => (ORDER_TYPE_LABELS[o] ?? o).toLowerCase()).join(" or ")} orders` : null,
    w.direction ? `${w.direction} trades` : null,
    w.price_below != null ? `prices under ${money(w.price_below)}` : null,
  ].filter(Boolean);
  return parts.length ? `, only on ${parts.join(", ")}` : "";
}

const WHEN_PHRASE: Record<FeeSide, string> = {
  both: "when you buy and when you sell",
  entry: "when you open a trade",
  exit: "when you close a trade",
  buy: "when you buy",
  sell: "when you sell",
};

function describeLine(l: FeeComponent, lead: string): string {
  const what = l.tiers && l.tiers.length > 0 ? describeTiers(l) : describeAmount(l);
  const fx =
    l.currency && l.fx_rate ? ` (${money(1, l.currency)} = ${money(l.fx_rate)})` : "";
  const from = l.taken_from === "shares" ? ", taken from the shares you buy" : "";
  return `${lead}${what} ${WHEN_PHRASE[l.side]}${describeLimits(l)}${describeCondition(l)}${from}${fx}`;
}

/** What a rule charges, as sentences a trader reads without a manual. */
export function describeRule(rule: CommissionRule): string[] {
  const lines: FeeComponent[] =
    rule.components && rule.components.length > 0
      ? rule.components
      : [
          {
            label: "Commission",
            basis: rule.rule_type,
            amount: Number(rule.amount),
            side: rule.applies_to,
            min_fee: rule.min_fee,
            max_fee: rule.max_fee,
          },
        ];
  if (lines.every((l) => Number(l.amount) === 0 && l.min_fee == null && !(l.tiers && l.tiers.length))) return ["No fees"];
  return lines.map((l, i) => {
    const plainLabel = ["Commission", "Buy fee", "Sell fee"].includes(l.label) && i < 2;
    return describeLine(l, plainLabel ? "" : `${l.label}: `);
  });
}

/** Which trades a rule covers, in words. */
export function describeScope(rule: Pick<CommissionRule, "asset_type" | "market">): string {
  const parts = [rule.asset_type, rule.market].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} trades only` : "All trades";
}

/** The example trade every rule is shown on: 100 shares at $50, a $5,000 position. */
export const EXAMPLE = { shares: 100, price: 50 };

/** What a rule costs on the example, bought and sold at the same price. */
export function exampleCost(rule: CommissionRule): { buy: number; sell: number; total: number } {
  const r = tryIt(rule, EXAMPLE.shares, EXAMPLE.price);
  return { buy: r.buy, sell: r.sell, total: r.total };
}

/** The live calculator's figures for a trade of `shares` bought at `price`. */
export function tryIt(
  rule: CommissionRule,
  shares: number,
  price: number,
  opts: { direction?: "long" | "short"; orderType?: string | null } = {},
) {
  const trade = {
    asset_type: rule.asset_type,
    market: rule.market,
    status: "closed",
    direction: opts.direction ?? "long",
    order_type: opts.orderType ?? null,
    entry_price: price,
    exit_price: price,
    shares,
  };
  const b = computeCommission(rule, trade);
  return {
    // For a long, entry is the buy; for a short, entry is the sell.
    buy: trade.direction === "short" ? b.exitFee : b.entryFee,
    sell: trade.direction === "short" ? b.entryFee : b.exitFee,
    entry: b.entryFee,
    exit: b.exitFee,
    total: b.total,
    breakeven: computeBreakevenPrice(rule, trade),
    coverBuy: computeEntryCoverPrice(rule, trade),
  };
}

/** A name from the answers: "Crypto: 0.1% of the trade", "$2.50 a trade". */
export function suggestName(form: FeeForm): string {
  const main = form.charges[0];
  if (!main) return form.asset_type ? `${form.asset_type}: no fees` : "No fees";
  const phrase = (c: ChargeForm) => {
    const amount = Number(c.amount || 0);
    const cur = c.currency || "USD";
    const one = (a: number) =>
      c.basis === "percent" ? `${a}%` : c.basis === "per_unit" ? `${money(a, cur)} a share` : money(a, cur);
    const bands = c.tiers.filter((t) => t.amount.trim() !== "");
    if (bands.length > 1) {
      return `${one(Number(bands[0].amount))} → ${one(Number(bands[bands.length - 1].amount))} by trade size`;
    }
    return c.basis === "percent" ? `${amount}% of the trade` : c.basis === "per_unit" ? `${money(amount, cur)} a share` : `${money(amount, cur)} a trade`;
  };
  let what: string;
  if (isSplit(form)) {
    what = `${phrase(form.charges[0])} to buy, ${phrase(form.charges[1])} to sell`;
  } else {
    const when = main.side === "entry" ? ", on open" : main.side === "exit" ? ", on close" : "";
    what = `${phrase(main)}${when}`;
  }
  const extras = form.charges.length - (isSplit(form) ? 2 : 1);
  return `${form.asset_type ? `${form.asset_type}: ` : ""}${what}${extras > 0 ? ` + ${extras} more` : ""}`;
}

export { money as formatFee };
