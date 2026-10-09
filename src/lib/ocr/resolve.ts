// After reading: decide what an order's own prices mean, translate the order
// type and time in force into the trade's values, and turn failed checks into
// sentences the review screen shows (Problem 2 of the hardening brief).
//
// The rule throughout: never guess. When the meaning of a number depends on
// something the screenshot doesn't say, it becomes a SUGGESTION (heuristic,
// confidence capped below the auto-fill bar) that the user accepts or not.

import type { DetectedField, DetectedFields, FieldKey, ParseResult, ValidationNote } from "./types";
import { AUTOFILL_CONFIDENCE, FIELD_LABELS } from "./types";
import { normalizeOrderType, normalizeTimeInForce } from "./labels";

const SUGGESTION_CONFIDENCE = Math.min(0.5, AUTOFILL_CONFIDENCE - 0.05);

function suggestion(key: FieldKey, from: DetectedField, source: string): DetectedField {
  return { key, value: from.value, confidence: Math.min(from.confidence, SUGGESTION_CONFIDENCE), source, raw: from.raw, heuristic: true };
}

export interface Resolved {
  fields: DetectedFields;
  /** Values with no trade column, shown under "Also read". */
  extra: ParseResult["extra"];
  notes: ValidationNote[];
}

export function resolveOrderFields(input: DetectedFields, rawText = ""): Resolved {
  const fields: DetectedFields = { ...input };
  const extra: ParseResult["extra"] = [];
  const notes: ValidationNote[] = [];
  const keepAsExtra = (f: DetectedField) =>
    extra.push({ key: f.key, label: FIELD_LABELS[f.key], value: f.value, confidence: f.confidence });

  // ---- order type: only a recognised value is kept.
  if (fields.order_type) {
    const n = normalizeOrderType(String(fields.order_type.value));
    if (n) {
      fields.order_type = { ...fields.order_type, value: n.value, raw: n.other ?? fields.order_type.raw ?? String(fields.order_type.value) };
    } else {
      notes.push({ field: "order_type", ok: false, message: `"${String(fields.order_type.value)}" isn't an order type we recognise` });
      delete fields.order_type;
    }
  }
  // No labelled order type: the ticket's own order summary line states it,
  // e.g. "10AAPL@278.00LMT", "0.2626TXT@95.20STOP", "Buy 10 SPY MKT". That is
  // the platform's text, not an inference, so it is not a suggestion.
  const fromSummary = orderTypeFromSummary(rawText);
  // The summary also names the symbol. When the ticker came only from the
  // weakest rule (the first capitalised word in the header) and the summary
  // disagrees, the summary wins: on TradingView the logo's "S" glued onto
  // "SPY" read as "SSPY", while the order line said "10SPYMKT".
  if (fromSummary && fields.ticker?.source === "header symbol" && fields.ticker.value !== fromSummary.symbol) {
    notes.push({ field: "ticker", ok: true, message: `ticker ${fromSummary.symbol} from the order summary (header read ${String(fields.ticker.value)})` });
    fields.ticker = { ...fields.ticker, value: fromSummary.symbol, source: "the order summary line", raw: fromSummary.raw };
  }
  if (!fields.order_type) {
    if (fromSummary) {
      fields.order_type = {
        key: "order_type",
        value: fromSummary.value,
        confidence: 0.8,
        source: "the order summary line",
        raw: fromSummary.raw,
      };
    }
  }
  const orderType = fields.order_type ? String(fields.order_type.value) : null;

  // ---- time in force: only GTC / Day exist on a trade.
  if (fields.time_in_force) {
    const tif = normalizeTimeInForce(String(fields.time_in_force.value));
    if (tif) fields.time_in_force = { ...fields.time_in_force, value: tif, raw: fields.time_in_force.raw ?? String(fields.time_in_force.value) };
    else {
      keepAsExtra(fields.time_in_force);
      delete fields.time_in_force;
    }
  }

  // A bracket/exit dialog names its orders: "Take-Profit Order ... Limit
  // Price 10.50", "Stop-Loss Order ... Stop Price 9.50". There the prices
  // ARE the target and the stop -- the screen says so.
  const exitDialog = {
    takeProfit: /\btake[\s-]?profit\s+order\b/i.test(rawText),
    stopLoss: /\bstop[\s-]?loss\s+order\b/i.test(rawText),
  };

  // ---- stop price: the entry of a stop order, or a protective stop.
  const stop = fields.stop_price;
  if (stop) {
    delete fields.stop_price;
    keepAsExtra(stop);
    if (exitDialog.stopLoss && !fields.stop_loss) {
      fields.stop_loss = { ...stop, key: "stop_loss", source: "stop price of a \"Stop-Loss Order\"" };
    } else if ((orderType === "stop" || orderType === "stop_limit") && !fields.entry_price) {
      fields.entry_price = suggestion("entry_price", stop, "the stop price of a stop order (its entry trigger)");
    } else if (!orderType && !fields.stop_loss) {
      fields.stop_loss = suggestion("stop_loss", stop, "\"stop price\": a stop-loss, unless this is a stop ENTRY order");
    }
  }

  // ---- limit price: a stop-limit's second price, or a limit order's entry.
  const limit = fields.limit_price;
  if (limit && orderType !== "stop_limit") {
    delete fields.limit_price;
    keepAsExtra(limit);
    if (exitDialog.takeProfit && !fields.take_profit) {
      fields.take_profit = { ...limit, key: "take_profit", source: "limit price of a \"Take-Profit Order\"" };
    } else if (!fields.entry_price) {
      fields.entry_price = suggestion(
        "entry_price",
        limit,
        orderType === "limit" ? "the limit price of a limit order" : "\"limit price\": your entry, if this order opens the trade",
      );
    }
  }

  // ---- direction from the stop and target. A protective stop sits on the
  // losing side of the entry and a target on the winning side, so when both
  // agree they SAY which way the trade is. That settles an ambiguous "Sell".
  // Only from prices read beside their own labels, never from suggestions.
  const dir = fields.direction;
  const entry = num(fields.entry_price);
  const sl = num(fields.stop_loss);
  const tp = num(fields.take_profit);
  if (entry !== null && (sl !== null || tp !== null) && (!dir || dir.heuristic)) {
    const shortSide = (sl === null || sl > entry) && (tp === null || tp < entry);
    const longSide = (sl === null || sl < entry) && (tp === null || tp > entry);
    if (shortSide !== longSide && sl !== null && tp !== null) {
      const value = shortSide ? "short" : "long";
      fields.direction = {
        key: "direction",
        value,
        confidence: 0.8,
        source: `the stop and target are on the ${value} side of the entry`,
      };
      notes.push({ field: "direction", ok: true, message: `direction ${value} from stop/target placement` });
    }
  }

  return { fields, extra, notes };
}

// qty, symbol, optional "@ price", then the type -- with or without spaces,
// since OCR often glues the summary into one token.
const SUMMARY_RE =
  /\b\d[\d.,]*\s*([A-Z][A-Z0-9.]{0,9}?)\s*(?:@\s*\d[\d.,]*\s*)?(STP\s*LMT|STOP\s*LIMIT|LMT|LIMIT|STP|STOP|MKT|MARKET|TRAIL)\b/;

export function orderTypeFromSummary(rawText: string): { value: string; symbol: string; raw: string } | null {
  for (const line of rawText.split(/\n/)) {
    const m = line.match(SUMMARY_RE);
    if (!m) continue;
    const n = normalizeOrderType(m[2]);
    if (n) return { value: n.value, symbol: m[1], raw: m[0] };
  }
  return null;
}

function num(f: DetectedField | undefined): number | null {
  if (!f || f.heuristic) return null;
  return typeof f.value === "number" && Number.isFinite(f.value) ? f.value : null;
}

/** Failed checks and red flags, as sentences for the review screen. */
export function warningsFor(notes: ValidationNote[], rawText: string): string[] {
  const out: string[] = [];
  for (const n of notes) {
    if (n.ok) continue;
    if (/pipeline error/.test(n.message)) continue;
    out.push(sentence(n));
  }
  if (/\b(?:cancel+ed|rejected)\b/i.test(rawText)) {
    out.unshift("The screenshot says this order was cancelled or rejected. A cancelled order isn't a trade; check before saving.");
  }
  return [...new Set(out)];
}

function sentence(n: ValidationNote): string {
  const m = n.message;
  if (/Entry×Shares/.test(m)) return `Entry × shares doesn't match the total shown (${m.replace(/^.*\((.*)\)$/, "$1")}). One of those numbers may be misread.`;
  if (/R\/R/.test(m)) return `The risk/reward shown doesn't match entry, stop and target (${m.replace(/^.*≠ /, "")}).`;
  if (/wrong side/.test(m)) return "The stop or target is on the wrong side of the entry for this direction. Check the direction and both prices.";
  if (/entry date after exit date/.test(m)) return "The entry date is after the exit date.";
  const label = n.field === "cross" ? "" : `${FIELD_LABELS[n.field] ?? n.field}: `;
  return `${label}${m}`;
}
