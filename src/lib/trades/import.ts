import type { FieldDefinition } from "@/lib/fields/types";
import { computeDerivedFields } from "./compute";
import type { EditableCoreField, TradeCoreFields, TradeDirection } from "./types";

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
    return Number.isFinite(num) ? { value: num, error: null } : { value: null, error: `invalid number for ${field}: "${raw}"` };
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

    const { value, error } = parseCoreValue(target, raw);
    if (error) errors.push(error);
    else core[target] = value;
  }

  if (!core.ticker) errors.push("missing ticker");

  return { core, custom_fields, error: errors.length > 0 ? errors.join("; ") : null };
}

export function withDerivedFields(core: Record<string, unknown>): Record<string, unknown> {
  const derived = computeDerivedFields({
    entry_price: (core.entry_price as number) ?? null,
    exit_price: (core.exit_price as number) ?? null,
    stop_loss: (core.stop_loss as number) ?? null,
    take_profit: (core.take_profit as number) ?? null,
    shares: (core.shares as number) ?? null,
    risk_amount: (core.risk_amount as number) ?? null,
    direction: (core.direction as TradeDirection) ?? null,
  } satisfies TradeCoreFields);

  return { ...core, ...derived };
}
