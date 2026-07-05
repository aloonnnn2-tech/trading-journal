// Value normalization: turn raw OCR fragments into clean numbers and dates.
// Kept engine-agnostic so both the semantic parser and validator can reuse it.

import { parse as parseDateFns, isValid } from "date-fns";

// A price/quantity token: 1,234.56 / 189.32 / 100 / .50 — commas are grouping.
export const NUM_RE = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;

/**
 * Parse a numeric value out of an OCR fragment. Handles $ / currency symbols,
 * thousands separators, parenthesised or signed negatives, and k/M/B suffixes.
 * Returns null when there is no plausible number.
 */
export function parseNumber(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim();

  // Parenthesised negative: (1,234.50) -> -1234.50 (accounting notation)
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // A "1,000 - 1,200" range (day's range, bid/ask spread, ...) reads a hyphen
  // between two numbers — that's a separator, not a minus sign. Only treat a
  // hyphen as negative when it isn't sitting between two numeric values.
  const isRange = new RegExp(String.raw`(?:${NUM_RE})\s*-\s*(?:${NUM_RE})`).test(s);
  if (!isRange && /(^|[^A-Za-z])-\s*\d/.test(s)) negative = true;

  // Suffix multiplier (1.5k, 2.3M) — only when glued to the number.
  let mult = 1;
  const suffix = s.match(/(\d)\s*([kKmMbB])\b/);
  if (suffix) {
    const c = suffix[2].toLowerCase();
    mult = c === "k" ? 1e3 : c === "m" ? 1e6 : 1e9;
  }

  const m = s.match(new RegExp(NUM_RE));
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const value = n * mult;
  return negative ? -value : value;
}

/** True if the fragment leads with a number (usable as a label's value). */
export function looksLikeValue(raw: string): boolean {
  return new RegExp(String.raw`^[^A-Za-z0-9(]*[\$€£¥]?\s*(?:\(?\s*)?(?:${NUM_RE})`).test(raw.trim());
}

const DATE_FORMATS = [
  "yyyy-MM-dd",
  "yyyy/MM/dd",
  "MM/dd/yyyy",
  "dd/MM/yyyy",
  "MM-dd-yyyy",
  "dd-MM-yyyy",
  "dd.MM.yyyy",
  "yyyy.MM.dd",
  "MMM d, yyyy",
  "MMM d yyyy",
  "d MMM yyyy",
  "MMMM d, yyyy",
  "yyyy-MM-dd HH:mm:ss",
  "yyyy-MM-dd HH:mm",
  "MM/dd/yyyy HH:mm:ss",
  "MM/dd/yyyy HH:mm",
  "dd/MM/yyyy HH:mm",
];

/**
 * Parse a date/time fragment into an ISO string. Returns null on anything
 * that doesn't cleanly parse — the spec forbids inventing dates. Sanity-bounds
 * the year so a quantity like "100 2024" can't masquerade as a date.
 */
export function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, " ");
  for (const fmt of DATE_FORMATS) {
    const d = parseDateFns(s, fmt, new Date());
    if (isValid(d)) {
      const year = d.getFullYear();
      if (year < 1990 || year > 2100) continue;
      return fmt.includes("HH") ? d.toISOString() : toIsoDate(d);
    }
  }
  // Bare ISO datetime the formats above didn't cover. Require the string to
  // actually start with a digit first — JS's native Date parser is lenient
  // enough to extract a date from leading junk text (e.g. new Date("Opened
  // 2026-06-01") succeeds), which would wrongly treat a label word stuck to
  // the front of a date as part of the date itself.
  if (!/^\d/.test(s)) return null;
  const native = new Date(s);
  if (isValid(native) && /\d{4}/.test(s)) {
    const year = native.getFullYear();
    if (year >= 1990 && year <= 2100) return native.toISOString();
  }
  return null;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Collapse whitespace and strip stray decoration OCR adds around text. */
export function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Normalize a label token for matching: lowercase alphanumerics + slash.
 * Spaces around a slash are removed so OCR's "S / L" matches the alias "s/l". */
export function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9/&%]+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if a whitespace-delimited token is a clean standalone number, i.e. not
 * a digit glued inside a word ("L0ss" is a mis-OCR of "Loss", not a value). */
export function isNumericToken(token: string): boolean {
  const s = token.replace(/^[$€£¥(+\-]+/, "").replace(/[)%,]+$/, "");
  return /^\d[\d,]*(?:\.\d+)?$/.test(s) || /^\.\d+$/.test(s);
}
