import { computeBreakevenPrice, computeCommission, computeEntryCoverPrice } from "./calculate";
import type { CommissionRule, CommissionRuleType, FeeComponent, FeeSide } from "./types";

// The Commissions page's form, in the words a trader uses -- and the
// translation between it and a stored rule. Pure, so it is tested directly.
//
// A form is a main charge (the questions: how, when, min/max) plus optional
// "other charges" (regulatory fees, FX) that presets bring and anyone can
// add. One plain charge saves as an old single-line rule, which works before
// migration 0055; anything richer saves as `components`.

export interface ChargeForm {
  label: string;
  basis: CommissionRuleType;
  amount: string;
  side: FeeSide;
  min_fee: string;
  max_fee: string;
  max_percent: string;
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

/** The three choices the main question offers. `buy`/`sell` stay for "other charges". */
export const MAIN_WHEN: FeeSide[] = ["both", "entry", "exit"];

const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function chargeFromComponent(c: FeeComponent): ChargeForm {
  return {
    label: c.label,
    basis: c.basis,
    amount: c.amount === 0 ? "" : String(c.amount),
    side: c.side,
    min_fee: str(c.min_fee),
    max_fee: str(c.max_fee),
    max_percent: str(c.max_percent),
  };
}

export function formFromRule(rule: CommissionRule): FeeForm {
  const charges =
    rule.components && rule.components.length > 0
      ? rule.components.map(chargeFromComponent)
      : [
          {
            label: "Commission",
            basis: rule.rule_type,
            amount: String(rule.amount),
            side: rule.applies_to,
            min_fee: str(rule.min_fee),
            max_fee: str(rule.max_fee),
            max_percent: "",
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
  const charges = components.length > 0 ? components.map(chargeFromComponent) : [];
  return {
    ...BLANK_FORM,
    charges,
    name: extra.name ?? "",
    nameTouched: !!extra.name,
    asset_type: extra.asset_type ?? "",
    preset_id: extra.preset_id ?? null,
  };
}

function toComponent(c: ChargeForm): FeeComponent {
  return {
    label: c.label.trim() || "Fee",
    basis: c.basis,
    amount: Number(c.amount || 0),
    side: c.side,
    min_fee: num(c.min_fee),
    max_fee: num(c.max_fee),
    max_percent: num(c.max_percent),
  };
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
    (form.charges.length === 1 && (only.side === "both" || only.side === "entry" || only.side === "exit") && !only.max_percent.trim());
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

function money(n: number): string {
  // Small per-share rates need more than cents to read truthfully.
  // FINRA's TAF is $0.000195 a share; rounding it to $0.0002 would misstate it.
  const abs = Math.abs(n);
  const decimals = abs === 0 ? 2 : abs < 0.01 ? 6 : abs < 0.1 ? 4 : 2;
  return `$${n.toFixed(decimals).replace(/(\.\d\d\d*?)0+$/, "$1")}`;
}

/** One charge as a phrase: "$2.50", "$0.005 a share", "0.1% of the trade". */
export function describeAmount(c: Pick<FeeComponent, "basis" | "amount">): string {
  if (c.basis === "percent") return `${c.amount}% of the trade`;
  if (c.basis === "per_unit") return `${money(c.amount)} a share`;
  return money(c.amount);
}

function describeLimits(c: Pick<FeeComponent, "min_fee" | "max_fee" | "max_percent">): string {
  const parts = [
    c.min_fee != null ? `at least ${money(c.min_fee)}` : null,
    c.max_fee != null ? `at most ${money(c.max_fee)}` : null,
    c.max_percent != null ? `at most ${c.max_percent}% of the trade` : null,
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

const WHEN_PHRASE: Record<FeeSide, string> = {
  both: "when you buy and when you sell",
  entry: "when you open a trade",
  exit: "when you close a trade",
  buy: "on buys",
  sell: "on sells",
};

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
  if (lines.every((l) => Number(l.amount) === 0 && l.min_fee == null)) return ["No fees"];
  return lines.map((l, i) => {
    const lead = i === 0 && l.label === "Commission" ? "" : `${l.label}: `;
    return `${lead}${describeAmount(l)} ${WHEN_PHRASE[l.side]}${describeLimits(l)}`;
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
  const trade = {
    asset_type: rule.asset_type,
    market: rule.market,
    status: "closed",
    direction: "long",
    entry_price: EXAMPLE.price,
    exit_price: EXAMPLE.price,
    shares: EXAMPLE.shares,
  };
  const b = computeCommission(rule, trade);
  return { buy: b.entryFee, sell: b.exitFee, total: b.total };
}

/** The live calculator's figures for a long trade of `shares` bought at `price`. */
export function tryIt(rule: CommissionRule, shares: number, price: number) {
  const trade = {
    asset_type: rule.asset_type,
    market: rule.market,
    status: "closed",
    direction: "long",
    entry_price: price,
    exit_price: price,
    shares,
  };
  const b = computeCommission(rule, trade);
  return {
    buy: b.entryFee,
    sell: b.exitFee,
    total: b.total,
    breakeven: computeBreakevenPrice(rule, trade),
    coverBuy: computeEntryCoverPrice(rule, trade),
  };
}

/** A name from the answers: "Crypto: 0.1% of the trade", "$2.50 a trade". */
export function suggestName(form: FeeForm): string {
  const main = form.charges[0];
  if (!main) return form.asset_type ? `${form.asset_type}: no fees` : "No fees";
  const amount = Number(main.amount || 0);
  const what =
    main.basis === "percent" ? `${amount}% of the trade` : main.basis === "per_unit" ? `${money(amount)} a share` : `${money(amount)} a trade`;
  const when = main.side === "entry" ? ", on open" : main.side === "exit" ? ", on close" : "";
  const extra = form.charges.length > 1 ? ` + ${form.charges.length - 1} more` : "";
  return `${form.asset_type ? `${form.asset_type}: ` : ""}${what}${when}${extra}`;
}

export { money as formatFee };
