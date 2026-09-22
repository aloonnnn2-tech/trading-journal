import type { FieldDefinition } from "@/lib/fields/types";
import type { Strategy } from "@/lib/strategies/types";
import { renderValue } from "../context";
import { dateOnly, strategyNames, type Row } from "./filter";

/**
 * The compact row used in lists. Explicit fields only.
 */
export function compactRow(t: Row): Record<string, unknown> {
  const out: Record<string, unknown> = { id: t.id, ticker: t.ticker, status: t.status };
  if (t.mode === "investment") out.mode = "investment";
  for (const k of [
    "direction",
    "market",
    "result",
    "entry_date",
    "exit_date",
    "entry_price",
    "exit_price",
    "stop_loss",
    "take_profit",
    "shares",
    "risk_percent",
    "dollar_pl",
    "r_multiple",
    "commission",
  ] as const) {
    const v = t[k];
    if (v != null) out[k] = k.endsWith("_date") ? dateOnly(v) : v;
  }
  const strat = strategyNames(t);
  if (strat.length) out.strategies = strat;
  return out;
}

/**
 * The full detail of one trade, as an ALLOWLIST.
 *
 * The first get_trade spread the raw row (`...rest`), which sent everything
 * the column list happened to include: `user_id`, `dismissed_suggestions`
 * (a housekeeping column deliberately kept out of prompts -- see 0037),
 * `commission_manual`, and `strategy_field_values` keyed by strategy UUIDs
 * the model could do nothing with. This names every field that goes out,
 * and renders custom fields under the user's own labels rather than keys.
 */
export function compactTradeDetail(
  t: Row,
  fields: { trade: FieldDefinition[]; investment: FieldDefinition[]; byStrategy: Record<string, FieldDefinition[]> },
  strategies: Strategy[],
  extras: { images?: { id: string; created_at: string }[] } = {},
): Record<string, unknown> {
  const out = compactRow(t);
  for (const k of [
    "company_name",
    "asset_type",
    "order_type",
    "position_size",
    "dollar_amount",
    "risk_amount",
    "percent_return",
    "risk_reward_ratio",
  ] as const) {
    const v = t[k];
    if (v != null) out[k] = v;
  }
  if (t.updated_at) out.updated_at = t.updated_at;

  // Custom fields under their labels. Notes, emotions, mistakes all live here.
  const defs = t.mode === "investment" ? fields.investment : fields.trade;
  const labelled: Record<string, string> = {};
  for (const def of defs) {
    const rendered = renderValue((t.custom_fields ?? {})[def.key]);
    if (rendered !== null) labelled[def.label] = rendered;
  }
  // Any key without a definition (a deleted field) still surfaces by key,
  // so nothing the user wrote silently disappears.
  for (const [key, raw] of Object.entries(t.custom_fields ?? {})) {
    if (defs.some((d) => d.key === key)) continue;
    const rendered = renderValue(raw);
    if (rendered !== null) labelled[key] = rendered;
  }
  if (Object.keys(labelled).length) out.fields = labelled;

  // Strategy-scoped fields, remapped from {strategyId: {key: value}} to
  // {strategyName: {label: value}}.
  const byName: Record<string, Record<string, string>> = {};
  for (const [sid, values] of Object.entries(t.strategy_field_values ?? {})) {
    const name = strategies.find((s) => s.id === sid)?.name;
    if (!name || !values || typeof values !== "object") continue;
    const sdefs = fields.byStrategy[sid] ?? [];
    const entry: Record<string, string> = {};
    for (const [key, raw] of Object.entries(values)) {
      const rendered = renderValue(raw);
      if (rendered === null) continue;
      entry[sdefs.find((d) => d.key === key)?.label ?? key] = rendered;
    }
    if (Object.keys(entry).length) byName[name] = entry;
  }
  if (Object.keys(byName).length) out.strategy_fields = byName;

  if (extras.images && extras.images.length) {
    out.images = extras.images.map((i) => ({ id: i.id, added: dateOnly(i.created_at) }));
  }
  return out;
}
