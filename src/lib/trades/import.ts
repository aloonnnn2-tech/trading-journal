import type { FieldDefinition } from "@/lib/fields/types";
import { computeDerivedFields } from "./compute";
import { resultForClosedTrade } from "./result";
import {
  EDITABLE_CORE_FIELDS,
  type EditableCoreField,
  type TradeCoreFields,
  type TradeDirection,
} from "./types";

// The column mapping comes from the client, so a target naming a column the
// user has no business writing has to be dropped rather than trusted. Every
// other path that writes core fields already filters against this list
// (import-json, PATCH /api/trades/[id], the core-fields setting); the CSV
// path was the one that didn't. The import route spreads this result *after*
// user_id and mode, so a mapping of {"Column A": "user_id"} put a foreign id
// on the insert -- RLS rejects it, which is the saving grace, but the whole
// batch dies with it, and `id` or `created_at` would have been written
// verbatim.
const IMPORTABLE_CORE_FIELDS = new Set<string>(EDITABLE_CORE_FIELDS);

const NUMERIC_CORE_FIELDS = new Set([
  "entry_price",
  "exit_price",
  "stop_loss",
  "take_profit",
  "shares",
  "position_size",
  "dollar_amount",
  "risk_amount",
  "risk_percent",
  "commission",
]);
const DATE_CORE_FIELDS = new Set(["entry_date", "exit_date"]);
const ENUM_CORE_FIELDS: Record<string, string[]> = {
  status: ["pending", "open", "closed"],
  result: ["open", "win", "loss", "break_even"],
  direction: ["long", "short"],
  mode: ["trade", "investment"],
};

export type ImportTarget = "ignore" | EditableCoreField | `custom:${string}`;

export interface ImportRowResult {
  core: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  error: string | null;
}

function parseCoreValue(field: string, raw: string): { value: unknown; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: null };

  if (NUMERIC_CORE_FIELDS.has(field)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
      return { value: null, error: `invalid number for ${field}: "${raw}"` };
    }
    // Finite is not the same as usable. Past MAX_SAFE_INTEGER a double can no
    // longer represent consecutive integers, so the value is already wrong on
    // arrival -- and multiplying two such numbers (price x shares) overflows to
    // Infinity, which JSON.stringify writes to the database as null. That gave
    // a row imported "successfully" with a silently empty P/L, recorded as
    // break-even. Rejecting here reports it to the user instead, on the row it
    // came from. No real price, size or fee approaches this bound.
    if (Math.abs(num) > Number.MAX_SAFE_INTEGER) {
      return { value: null, error: `number too large for ${field}: "${raw}"` };
    }
    return { value: num, error: null };
  }

  if (DATE_CORE_FIELDS.has(field)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime())
      ? { value: null, error: `invalid date for ${field}: "${raw}"` }
      : { value: date.toISOString(), error: null };
  }

  if (field in ENUM_CORE_FIELDS) {
    const lower = trimmed.toLowerCase().replace(/\s+/g, "_");
    return ENUM_CORE_FIELDS[field].includes(lower)
      ? { value: lower, error: null }
      : { value: null, error: `invalid value for ${field}: "${raw}"` };
  }

  return { value: trimmed, error: null };
}

function parseCustomValue(field: FieldDefinition, raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  switch (field.field_type) {
    case "number":
    case "currency":
    case "percentage":
    case "rating": {
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : null;
    }
    case "checkbox":
      return ["true", "1", "yes", "y"].includes(trimmed.toLowerCase());
    case "multi_select":
    case "tag":
      return trimmed.split(";").map((v) => v.trim()).filter(Boolean);
    default:
      return trimmed;
  }
}

// Converts one spreadsheet row into trade insert fields using the
// user's chosen column mapping. Missing/invalid values are recorded as
// row-level errors but don't abort the whole import -- the row is still
// inserted with whatever parsed cleanly, matching the spec's "show
// validation errors inline" rather than failing the entire file.
export function buildRowFromMapping(
  row: Record<string, string>,
  mapping: Record<string, ImportTarget>,
  fieldDefinitionsById: Map<string, FieldDefinition>,
): ImportRowResult {
  const core: Record<string, unknown> = {};
  const custom_fields: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [sourceColumn, target] of Object.entries(mapping)) {
    if (target === "ignore") continue;
    const raw = row[sourceColumn] ?? "";

    if (target.startsWith("custom:")) {
      const fieldId = target.slice("custom:".length);
      const field = fieldDefinitionsById.get(fieldId);
      if (field) custom_fields[field.key] = parseCustomValue(field, raw);
      continue;
    }

    if (!IMPORTABLE_CORE_FIELDS.has(target)) {
      errors.push(`unknown column target: "${target}"`);
      continue;
    }

    const { value, error } = parseCoreValue(target, raw);
    if (error) errors.push(error);
    else core[target] = value;
  }

  if (!core.ticker) errors.push("missing ticker");

  return { core, custom_fields, error: errors.length > 0 ? errors.join("; ") : null };
}

// Imports used to hard-code every row as `status: "closed", result: "open"`,
// which the Trades list renders as a contradictory "closed / open" pair of
// badges and which makes result-based filtering wrong for the whole import.
// Derive both from the data instead, and let an explicitly mapped
// status/result column win over the inference.
export function deriveStatusAndResult(
  core: Record<string, unknown>,
  derived: Record<string, unknown>,
): { status: string; result: string } {
  const explicitStatus = typeof core.status === "string" ? core.status : null;
  const explicitResult = typeof core.result === "string" ? core.result : null;

  // A row counts as closed if it carries any evidence the trade finished:
  // an exit price, an exit date, or a computed P/L.
  const looksClosed =
    core.exit_price != null || core.exit_date != null || derived.dollar_pl != null;
  const status = explicitStatus ?? (looksClosed ? "closed" : "open");

  // A row closed on exit_date alone has no dollar_pl to judge by. Plain
  // resultFromPL(null) answers "open" to that -- which is how the very
  // pairing this function exists to prevent, closed/open, was still getting
  // written; resultForClosedTrade is the variant that records break-even
  // instead, keeping the badge consistent with the status.
  const result =
    explicitResult ?? (status === "closed" ? resultForClosedTrade(derived.dollar_pl as number | null) : "open");

  return { status, result };
}

// `commission` is passed in by the import routes, which resolve it from the
// user's commission rules (or from an explicitly mapped commission column in
// the source file) before calling this -- so an imported trade's P&L is net
// of fees exactly like one logged in the app.
export function withDerivedFields(
  core: Record<string, unknown>,
  commission: number | null = null,
): Record<string, unknown> {
  const derived = computeDerivedFields({
    entry_price: (core.entry_price as number) ?? null,
    exit_price: (core.exit_price as number) ?? null,
    stop_loss: (core.stop_loss as number) ?? null,
    take_profit: (core.take_profit as number) ?? null,
    shares: (core.shares as number) ?? null,
    risk_amount: (core.risk_amount as number) ?? null,
    direction: (core.direction as TradeDirection) ?? null,
    commission,
  } satisfies TradeCoreFields);

  return { ...core, ...derived };
}
