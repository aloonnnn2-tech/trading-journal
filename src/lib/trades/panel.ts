import type { FieldDefinition } from "@/lib/fields/types";
import type { StrategyAdherence } from "@/lib/plan-rules/types";
import type { Trade } from "@/lib/trades/types";

// The trade side panel on /trades (Phase 4A of docs/design-audit.md): what
// GET /api/trades/[id]/panel returns, and the pure pieces that shape it. The
// panel is a read-only summary -- editing stays on /trades/[id].

export interface TradePanelData {
  trade: Trade;
  strategyNames: string[];
  /** Whether the trade has any strategy -- a different empty state from
   *  "tagged, but no rules". */
  hasStrategies: boolean;
  adherences: StrategyAdherence[];
  images: { id: string; url: string }[];
  /** Notes and other text-like custom fields that have a value, in the
   *  user's field order. */
  textFields: { key: string; label: string; value: string }[];
}

/** Field types whose value reads as text in a summary. Numbers, dates,
 *  checkboxes, ratings and colours need their own formatting and live on the
 *  full page. */
const TEXT_LIKE = new Set<FieldDefinition["field_type"]>(["text", "large_notes", "dropdown", "multi_select", "tag"]);

export function panelTextFields(
  definitions: FieldDefinition[],
  customFields: Record<string, unknown>,
): TradePanelData["textFields"] {
  return definitions
    .filter((d) => TEXT_LIKE.has(d.field_type))
    .flatMap((d) => {
      const raw = customFields[d.key];
      const value = Array.isArray(raw)
        ? raw.filter((v) => typeof v === "string" && v.trim()).join(", ")
        : typeof raw === "string"
          ? raw.trim()
          : "";
      return value ? [{ key: d.key, label: d.label, value }] : [];
    });
}

/**
 * The trade either side of `id` in the list's order, or null at an end. The
 * arrows stop at the first and last trade on the page rather than turning it
 * (Alon, 2026-09-28).
 */
export function neighbours(order: string[], id: string): { prev: string | null; next: string | null; index: number } {
  const index = order.indexOf(id);
  if (index === -1) return { prev: null, next: null, index: -1 };
  return {
    prev: index > 0 ? order[index - 1] : null,
    next: index < order.length - 1 ? order[index + 1] : null,
    index,
  };
}

/** How long a closed trade was held, e.g. "3h 20m" or "4d 2h". Null when
 *  either date is missing or they run backwards. */
export function holdTime(entry: string | null, exit: string | null): string | null {
  if (!entry || !exit) return null;
  const ms = Date.parse(exit) - Date.parse(entry);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return formatDuration(ms);
}

/** A duration as "25m", "3h 20m", "2h", "4d 2h" or "2d". Shared by the
 *  trade panel's hold time and the summary strip's average hold. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trade ids are uuids. Anything else would reach Postgres as a 22P02 and
 *  come back a 500 instead of a 404. */
export function isTradeId(id: string): boolean {
  return UUID.test(id);
}

/** U+2212, as formatMoney uses, so signed figures line up with the money. */
const MINUS = "−";

/** A price as entered: thousands separators, no currency symbol (crypto and
 *  stocks share the column), and up to 8 decimals so a sub-cent price isn't
 *  rounded to 0.00. "—" when absent. */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

/** A signed figure with a suffix: "+1.25R", "−2.40%". "—" when absent. */
export function formatSigned(value: number | null | undefined, suffix: string, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const body = Math.abs(value).toFixed(digits);
  if (Number(body) === 0) return `${body}${suffix}`;
  return `${value < 0 ? MINUS : "+"}${body}${suffix}`;
}
