// Semantic parsing: turn OCR lines + layout into candidate DetectedFields.
// This is where "150.25 next to Entry" becomes entry_price=150.25 rather than
// just a loose number. Every candidate records where it came from (source) and
// a preliminary confidence combining OCR confidence with label-match strength.

import type { DetectedField, FieldKey, OcrLine } from "./types";
import { FIELD_LABELS, NUMERIC_FIELDS, DATE_FIELDS } from "./types";
import { Layout } from "./layout";
import { matchLabel, splitMultiLabel, findTicker, findDirection, findStatus } from "./labels";
import { parseNumber, parseDate, looksLikeValue, cleanText, isNumericToken, normalizeLabel, NUM_RE } from "./normalize";

// Fields we resolve by finding a label and reading its adjacent value.
const LABELLED_NUMERIC: FieldKey[] = [
  "entry_price",
  "exit_price",
  "stop_loss",
  "take_profit",
  "shares",
  "position_size",
  "dollar_amount",
  "risk_amount",
  "risk_percent",
  "pnl_amount",
  "pnl_percent",
  "risk_reward_ratio",
  "current_price",
  "average_price",
];

const LABELLED_DATE: FieldKey[] = ["entry_date", "exit_date"];
const LABELLED_TEXT: FieldKey[] = ["broker", "account", "exchange", "currency", "order_id", "order_type", "company_name", "asset_type", "market"];

type Candidate = DetectedField;

export function parseSemantic(lines: OcrLine[]): Candidate[] {
  const layout = new Layout(lines);
  const texts = layout.texts;
  const candidates: Candidate[] = [];
  const push = (c: Candidate | null) => {
    if (c) candidates.push(c);
  };

  // --- Ticker / direction / status (keyword-based, whole image) ------------
  const ticker = findTicker(texts);
  if (ticker) {
    push({ key: "ticker", value: ticker.value, confidence: 0.9, source: ticker.source, raw: ticker.value });
  }
  const dir = findDirection(texts);
  if (dir) push({ key: "direction", value: dir.value, confidence: 0.85, source: dir.source });
  const status = findStatus(texts);
  if (status) push({ key: "status", value: status.value, confidence: 0.7, source: status.source });

  // --- Labelled fields via layout ------------------------------------------
  for (const line of layout.lines) {
    const parts = splitLabelValue(line.text);
    if (!parts) continue;

    // Multi-column summary row OCR merged onto one line ("Market Value Total
    // Cost Average Price"). Split it into its labels, split the value line
    // below into the same count of numbers, and zip them positionally —
    // tried before single-label matching so it takes priority over a partial
    // single match on the same line (e.g. just "...average price" matching).
    if (!parts.value) {
      const multi = splitMultiLabel(line.text);
      if (multi && multi.length >= 2) {
        const valueLine = layout.valueFor(line, (l) => looksLikeValue(l.text) && !matchLabel(l.text));
        const numbers = valueLine ? (valueLine.text.match(new RegExp(NUM_RE, "g")) ?? []) : [];
        if (valueLine && numbers.length === multi.length) {
          for (let i = 0; i < multi.length; i++) {
            const c = buildCandidate(multi[i].key, numbers[i], valueLine, 0.85, "multi-column row");
            if (c) push(c);
          }
        }
        // Either way, this line names 2+ different fields at once — don't
        // fall through to single-label matching below, which could only pick
        // one of them (via whichever alias scores highest) and pair it with
        // the wrong number. No confident split means no value, not a guess.
        continue;
      }
    }

    const match = matchLabel(parts.label);
    if (!match) continue;

    // Same-line value ("Stop Loss 147.80").
    if (parts.value) {
      const c = buildCandidate(match.key, parts.value, line, match.score, "same line");
      if (c) push(c);
      continue;
    }

    // Label-only line — hunt for the value spatially.
    const wantsNumber = NUMERIC_FIELDS.has(match.key);
    const wantsDate = DATE_FIELDS.has(match.key);
    const accept = (l: OcrLine) => {
      if (wantsNumber) return looksLikeValue(l.text) && !matchLabel(l.text);
      if (wantsDate) return parseDate(l.text) !== null;
      return l.text.trim().length > 0 && !matchLabel(l.text);
    };
    const valueLine = layout.valueFor(line, accept);
    if (valueLine) {
      const c = buildCandidate(match.key, valueLine.text, valueLine, match.score * 0.95, "adjacent to label");
      if (c) push(c);
    }
  }

  // Order-ticket "Price" field: some layouts (e.g. TradingView's Stop/Limit
  // order panel) label the entry price with nothing but the bare word
  // "Price" — no "Entry"/"Fill"/etc. qualifier. That's too ambiguous for the
  // general label dictionary (it would collide with "Mark Price"/"Last
  // Price"), so it's handled here as a narrow, anchored fallback: only a line
  // that normalizes to *exactly* "price" counts. "Mark Price"/"Last Price"/
  // "Take profit, price" don't qualify — they carry a prefix word and already
  // resolve through their own labels above.
  if (!has(candidates, "entry_price")) {
    const priceLine = layout.lines.find((l) => normalizeLabel(l.text) === "price");
    if (priceLine) {
      const valueLine = layout.valueFor(priceLine, (l) => looksLikeValue(l.text) && !matchLabel(l.text));
      if (valueLine) {
        const c = buildCandidate("entry_price", valueLine.text, valueLine, 0.75, "bare 'Price' field");
        if (c) push(c);
      }
    }
  }

  // --- Notation fallbacks (no explicit label) ------------------------------
  const joined = texts.join("\n");
  // Fallback matches can't span lines (patterns use [ \t], never \s), so the
  // matched substring always lives on exactly one OcrLine — find it so these
  // fields carry a box too (needed for disabled/greyed-field contrast checks).
  const lineFor = (matched: string): OcrLine | undefined => layout.lines.find((l) => l.text.includes(matched));

  // MT4/5 style "1.08432 -> 1.09105" (entry -> current). The second number is
  // the live/current price for an open position, so map it to current_price
  // (not exit) to avoid inventing a closed-trade exit.
  // All these whole-image fallbacks use [ \t] (never \s) so they can't span a
  // newline and scavenge a chart-axis price from the line above the label.
  if (!has(candidates, "entry_price")) {
    const arrow = joined.match(new RegExp(String.raw`(${NUM_RE})[ \t]*(?:->|→|—>|=>|~>|-»|»)[ \t]*(${NUM_RE})`));
    if (arrow) {
      const box = lineFor(arrow[0])?.box;
      const entry = parseNumber(arrow[1]);
      const second = parseNumber(arrow[2]);
      if (entry !== null) push({ key: "entry_price", value: entry, confidence: 0.6, source: "arrow notation", raw: arrow[0], box });
      if (second !== null && !has(candidates, "current_price")) {
        push({ key: "current_price", value: second, confidence: 0.5, source: "arrow notation (current)", raw: arrow[0], box });
      }
    }
  }

  // Broker fill notation: "BOT 100 AAPL @ 189.32".
  if (!has(candidates, "entry_price")) {
    const at = joined.match(new RegExp(String.raw`[@©][ \t]*\$?[ \t]*(${NUM_RE})`));
    if (at) {
      const n = parseNumber(at[1]);
      if (n !== null) push({ key: "entry_price", value: n, confidence: 0.55, source: "fill notation (@)", raw: at[0], box: lineFor(at[0])?.box });
    }
  }

  // Reversed quantity: "100 shares", "0.5 contracts".
  if (!has(candidates, "shares")) {
    const m = joined.match(new RegExp(String.raw`(${NUM_RE})[ \t]*(?:shares?|contracts?|units?)\b`, "i"));
    if (m) {
      const n = parseNumber(m[1]);
      if (n !== null) push({ key: "shares", value: n, confidence: 0.7, source: "quantity phrase", raw: m[0], box: lineFor(m[0])?.box });
    }
  }

  // Order-size notation: "BOT 100 AAPL", "EURUSD, buy 0.50" (MT4/5 lot size).
  if (!has(candidates, "shares")) {
    const m = joined.match(new RegExp(String.raw`(?:\b(?:bot|sld|bought|sold)|,[ \t]*(?:buy|sell))[ \t]+(${NUM_RE})\b`, "i"));
    if (m) {
      const n = parseNumber(m[1]);
      if (n !== null) push({ key: "shares", value: n, confidence: 0.6, source: "order size notation", raw: m[0], box: lineFor(m[0])?.box });
    }
  }

  return candidates;
}

function has(cands: Candidate[], key: FieldKey): boolean {
  return cands.some((c) => c.key === key);
}

/**
 * Split a line into a label and (optional) trailing value. Returns null if the
 * line starts with a value rather than a word (it's not a label line).
 *
 * The value is the *first* clean numeric token after the label, not the last —
 * broker UIs commonly trail the primary value with secondary numbers ("Mid
 * Price: 7.45 +2.95 +65.56%" — price, then daily change, then change%), and
 * the first one is always the field's own value. A digit OCR merges into a
 * word ("Stop L0ss 147.80" — the 0 in L0ss) still can't be mistaken for the
 * value either way, since isNumericToken requires the *whole* token to be
 * clean digits — "L0ss" never qualifies regardless of scan direction. Falls
 * back to a date, then a colon-separated text value.
 */
function splitLabelValue(text: string): { label: string; value: string | null } | null {
  const t = cleanText(text);
  if (!t || /^[^A-Za-z]/.test(t)) return null;

  const tokens = t.split(/\s+/);
  let valueIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (isNumericToken(tokens[i])) {
      valueIdx = i;
      break;
    }
  }
  if (valueIdx >= 1) {
    const label = tokens.slice(0, valueIdx).join(" ");
    const value = tokens.slice(valueIdx).join(" ");
    if (/[A-Za-z]/.test(label)) return { label, value };
  }

  // "Position Opened 2026-06-01" / "Entry Date Jan 5, 2024" — value is a date,
  // not a leading number. Scan from the longest trailing token-run down to a
  // single token (a date can be one or several tokens, e.g. "Jan 5, 2024" is
  // three) so a multi-word label like "Position Opened" doesn't get truncated
  // to just its last word, and a multi-token date doesn't get chopped to a
  // bare trailing year.
  const maxDateTokens = Math.min(4, tokens.length - 1);
  for (let len = maxDateTokens; len >= 1; len--) {
    const candidate = tokens.slice(tokens.length - len).join(" ");
    if (parseDate(candidate) !== null) {
      const label = tokens.slice(0, tokens.length - len).join(" ");
      if (/[A-Za-z]/.test(label)) return { label, value: candidate };
      break;
    }
  }

  // "Broker: Interactive Brokers" — colon-separated text value.
  const colon = t.match(/^([A-Za-z][A-Za-z0-9 %/&().-]*?):\s*(.+)$/);
  if (colon) return { label: colon[1].trim(), value: colon[2].trim() };

  // Whole line is (probably) just a label.
  return { label: t, value: null };
}

function buildCandidate(
  key: FieldKey,
  rawValue: string,
  line: OcrLine,
  labelScore: number,
  where: string,
): Candidate | null {
  const confidence = clamp(line.confidence * (0.6 + 0.4 * labelScore));
  const source = `${FIELD_LABELS[key]} — ${where}`;

  if (NUMERIC_FIELDS.has(key)) {
    const n = parseNumber(rawValue);
    if (n === null) return null;
    return { key, value: n, confidence, source, raw: rawValue, box: line.box };
  }
  if (DATE_FIELDS.has(key)) {
    const iso = parseDate(rawValue);
    if (iso === null) return null;
    return { key, value: iso, confidence, source, raw: rawValue };
  }
  if (LABELLED_TEXT.includes(key)) {
    const v = cleanText(rawValue);
    if (!v || v.length > 64) return null;
    // A market/company/broker name is never a bare number — reject numeric
    // values so an order-type tab like "Market" can't grab a chart price.
    if (/^[^A-Za-z]*[\d.,$€£¥\s]+$/.test(v) || !/[A-Za-z]/.test(v)) return null;
    return { key, value: v, confidence: clamp(confidence * 0.9), source, raw: rawValue };
  }
  return null;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Re-exported so the pipeline can note which field categories exist.
export { LABELLED_NUMERIC, LABELLED_DATE, LABELLED_TEXT };
