// Edit conflicts on a trade: two tabs, or a tab and the background order
// check, changing the same field.
//
// Autosave sends only the fields the user changed, plus `base`: the value
// each of those fields had when this page last heard from the server. A
// field conflicts when the stored value has moved off `base` since -- the
// change came from somewhere else -- AND differs from what this save would
// write. Anything else merges as before: a change to another field, or an
// identical change, is not a conflict.
//
// A save without `base` (older clients, the background fill sweep, which
// writes directly) is never checked, so nothing that saves today starts
// failing. The in-page fill hook saves through autosave and does send one.

export interface TradePatch {
  core?: Record<string, unknown>;
  customFields?: Record<string, unknown>;
  strategyFieldValues?: Record<string, Record<string, unknown>>;
}

export interface StoredTradeValues {
  core: Record<string, unknown>;
  customFields: Record<string, unknown>;
  strategyFieldValues: Record<string, Record<string, unknown>>;
}

/** A field that changed elsewhere, named the way the patch names it. */
export type ConflictField = { scope: "core" | "custom"; key: string } | { scope: "strategy"; strategyId: string; key: string };

/**
 * Same stored value, allowing for the shapes a value takes on its way
 * through JSON and Postgres: null and undefined alike, a numeric column
 * read back as "12.50" against 12.5, objects and arrays by content.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === b) return true;
  const numeric = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const na = numeric(a);
  const nb = numeric(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && (typeof a === "number" || typeof b === "number")) return na === nb;
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function changedElsewhere(stored: unknown, base: unknown, incoming: unknown): boolean {
  return !sameValue(stored, base) && !sameValue(stored, incoming);
}

export function findConflicts(stored: StoredTradeValues, patch: TradePatch, base: TradePatch): ConflictField[] {
  const conflicts: ConflictField[] = [];
  for (const [key, value] of Object.entries(patch.core ?? {})) {
    if (!base.core || !(key in base.core)) continue;
    if (changedElsewhere(stored.core[key], base.core[key], value)) conflicts.push({ scope: "core", key });
  }
  for (const [key, value] of Object.entries(patch.customFields ?? {})) {
    if (!base.customFields || !(key in base.customFields)) continue;
    if (changedElsewhere(stored.customFields[key], base.customFields[key], value)) conflicts.push({ scope: "custom", key });
  }
  for (const [strategyId, values] of Object.entries(patch.strategyFieldValues ?? {})) {
    const baseValues = base.strategyFieldValues?.[strategyId];
    if (!baseValues) continue;
    for (const [key, value] of Object.entries(values)) {
      if (!(key in baseValues)) continue;
      if (changedElsewhere(stored.strategyFieldValues[strategyId]?.[key], baseValues[key], value)) {
        conflicts.push({ scope: "strategy", strategyId, key });
      }
    }
  }
  return conflicts;
}

/** "stop_loss" -> "Stop loss", for naming a conflicting field on screen. */
export function conflictFieldLabel(field: ConflictField): string {
  const words = field.key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
