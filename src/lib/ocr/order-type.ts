// What kind of order the screenshot shows, from the screen's own words
// (2026-10-11, tested against 48 real screenshots from TradingView, IBKR TWS /
// Desktop / Client Portal / Mobile, Webull, MetaTrader 5, Trading 212,
// E*TRADE, Fidelity, tastytrade and thinkorswim -- kept locally, not in the
// repo, since they are other sites' images).
//
// The rule is the reader's rule everywhere: never guess. A type is filled in
// only when the screen STATES it for the order:
//   - beside its label           "Order Type STOP", "Price type ... Market"
//   - on the order's own button  "2 NQ1! @ 25,186.50 STP", "... STP / ... LMT"
//   - in the order's own row     "SELL 1,000 STP LMT 28.03" (IBKR TWS),
//                                "BUY +1 /MESH22 STP 4317.00" (thinkorswim)
//   - in an orders table's Type column, or a chart label "Buy Limit 81.86"
// and only when every such statement on the screen agrees. A screen with
// several different orders (a history list, a bracket) says nothing about
// which one is "the" trade, so nothing is filled in. Exit legs ("Stop Loss",
// "Take Profit" rows) are not the entry and are left out.
//
// Never evidence: a row of tabs or a menu listing three or more types
// ("Market Limit Stop Stop Limit"; only the highlight shows the choice,
// which text can't see -- that is a job for "Read with AI"), and phrases that
// merely contain a type word ("Stop Loss", "Limit Price", "Market Value").

export type OrderTypeValue = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";

export interface OrderTypeRead {
  value: OrderTypeValue;
  /** The words it was read from, for the review screen's "read as" hover. */
  raw: string;
  /** Plain words: where on the screen it came from. */
  source: string;
}

// Phrases that contain a type word but are not an order type.
const NOT_A_TYPE =
  /\b(?:stop[\s-]*loss(?:\s*type)?|stop[\s-]*(?:price|value|prc)|limit[\s.]*price|lmt[\s.]*price|lmt\s*px|market\s*(?:data|value|watch|cap|maker|info|hours|order[s]?\s*only)|mkt\s*scanner|take[\s-]*profit|trailing\s*(?:amount|amt)|stop[\s-]*out|limit\s*up|limit\s*down)\b/gi;

// One type word, most specific first. Case-insensitive, OCR-tolerant spacing
// ("STPLMT", "Stop-limit", "Trailing Stop $").
const TYPE_WORD =
  /\b(stp\s*lmt|stop[\s-]*limit|trail(?:ing)?[\s-]*stop|trail|lmt|limit|stp|stop|mkt|market)\b/gi;

function valueOf(word: string): OrderTypeValue {
  const w = word.toLowerCase().replace(/[\s-]+/g, "");
  if (w === "stplmt" || w === "stoplimit") return "stop_limit";
  if (w.startsWith("trail")) return "trailing_stop";
  if (w === "lmt" || w === "limit") return "limit";
  if (w === "stp" || w === "stop") return "stop";
  return "market";
}

/** The type words in a line, ignoring phrases that only contain one. */
function typesIn(line: string): { value: OrderTypeValue; word: string }[] {
  const clean = line.replace(NOT_A_TYPE, " ");
  return [...clean.matchAll(TYPE_WORD)].map((m) => ({ value: valueOf(m[1]), word: m[1] }));
}

/** A tab row or a menu: three or more different types on one line, or a
 *  line that is nothing but type words. Only a highlight says which. */
function isChoiceList(line: string): boolean {
  const types = typesIn(line);
  if (new Set(types.map((t) => t.value)).size >= 3) return true;
  const rest = line.replace(NOT_A_TYPE, " ").replace(TYPE_WORD, " ").replace(/\b(?:order|orders)\b/gi, " ");
  return types.length >= 2 && !/[a-z0-9]/i.test(rest);
}

interface Evidence {
  value: OrderTypeValue;
  raw: string;
  source: string;
  /** An entry, or an exit leg (stop loss / take profit) of a bracket. */
  exit?: boolean;
  /** An order on screen whose type can't be read: it might differ from the
   *  others, so nothing may be filled in. */
  unknown?: boolean;
}

// ---- 1. Beside its label: "Order Type STOP", "Ordee type Limit $200",
// "Price Type: Market", or the label on one line and the value under it.
const LABEL = /\b(?:ord\w{0,3}|price|ord\.?)\s*type\b\s*[:：]?/i;

function fromLabels(lines: string[]): Evidence[] {
  const out: Evidence[] = [];
  lines.forEach((line, i) => {
    const m = line.match(LABEL);
    if (!m || /\bstop\s*loss\s*type\b/i.test(line)) return;
    const after = line.slice((m.index ?? 0) + m[0].length);
    const same = typesIn(after)[0];
    // A table header ("Action  Order Type  Quantity  Limit Price") has other
    // column names after the label, not a value: those rows are read below.
    if (same && !isHeader(line)) {
      out.push({ value: same.value, raw: line.trim(), source: "beside its \"Order type\" label" });
      return;
    }
    if (isHeader(line)) return;
    for (const next of lines.slice(i + 1, i + 3)) {
      if (isChoiceList(next)) break;
      const t = typesIn(next)[0];
      if (t) {
        out.push({ value: t.value, raw: `${line.trim()} / ${next.trim()}`, source: "under its \"Order type\" label" });
        break;
      }
    }
  });
  return out;
}

// ---- 2. The order button / summary: "<qty> <symbol> @ <price> STP",
// "1 NQZ5 @ 24,755.00 STP / 24,755.25 LMT", "0.524 VEEV @ 313.53 STOP 316.21
// LIMIT" (a second price + LIMIT, with or without the slash, is a
// stop-limit), "10AAPL@278.00LMT", "Buy 10 SPY MKT".
// The symbol must not itself be a type word -- "1,000 STP LMT" once read as
// symbol STP, type LMT, and filled in a stop-limit as a plain limit.
const QTY = String.raw`\d[\d.,]*(?:\s\d{3})*`;
const SYMBOL = String.raw`(?!(?:STP|LMT|MKT|STOP|LIMIT|MARKET|TRAIL)\b)([A-Z][A-Z0-9.!/:_-]{0,14}?)`;
const PRICE = String.raw`\d[\d.,]*(?:\s\d[\d.,]*)?`;
const BUTTON_RE = new RegExp(
  String.raw`\b${QTY}\s*${SYMBOL}\s*(?:@\s*${PRICE}\s*)?(STP\s*LMT|STOP\s*LIMIT|LMT|LIMIT|STP|STOP|MKT|MARKET|TRAIL)\b(?:\s*/?\s*${PRICE}\s*(LMT|LIMIT)\b)?`,
);

export function orderSummary(rawText: string): { value: OrderTypeValue; symbol: string; raw: string } | null {
  for (const line of rawText.split(/\n/)) {
    const m = line.match(BUTTON_RE);
    if (!m) continue;
    const value = m[3] ? "stop_limit" : valueOf(m[2]);
    return { value, symbol: m[1], raw: m[0] };
  }
  return null;
}

// ---- 3. An order's own row: side, quantity, (symbol), type.
// IBKR TWS "· DAY SELL 1,000 STP LMT 28.03", thinkorswim "BUY +1 /MESH22 STP 4317.00".
// Neighbouring rows (other orders' types, the type dropdown) have no side
// and quantity before the type, so they never count.
const ROW_RE = new RegExp(
  String.raw`(?:BUY|SELL)\s*[+-]?${QTY}\s+(?:[A-Z/][A-Z0-9/.!_]*\s+)?(STP\s*LMT|STP|LMT|MKT|TRAIL)\b`,
  "i",
);

function fromOrderRows(lines: string[]): Evidence[] {
  const out: Evidence[] = [];
  for (const line of lines) {
    const m = line.match(ROW_RE);
    if (m) out.push({ value: valueOf(m[1]), raw: m[0], source: "the order's own row" });
  }
  return out;
}

// ---- 4. An orders table with a Type column, or a chart label: "Buy Limit
// 81.86", "NASDAQ:AAPL Sell Stop 228.78 Filled", "Buy Limit 1 @ 1.15040",
// MetaTrader's "BUYLIMIT 0.05 at 1.15918". A side word right before the type
// is what makes it an order and not a menu entry -- and "Sell Stop Loss" /
// "Sell Take Profit" rows are a bracket's exits.
// One stray OCR letter may sit between them ("Buy S Limit 72.41").
const SIDE_TYPE_RE = /(buy|sell)\s*(?:[A-Z]\s+)?(stop[\s-]*limit|stp\s*lmt|limit|lmt|stop[\s-]*loss|take[\s-]*profit|stop|stp|market|mkt)\b/gi;

function fromSideTypePhrases(lines: string[]): Evidence[] {
  const out: Evidence[] = [];
  for (const line of lines) {
    if (isChoiceList(line)) continue;
    for (const m of line.matchAll(SIDE_TYPE_RE)) {
      const word = m[2].toLowerCase().replace(/[\s-]+/g, "");
      if (word === "stoploss" || word === "takeprofit") {
        out.push({ value: "stop", raw: m[0], source: "an exit order", exit: true });
        continue;
      }
      // "Buy Mkt / Sell Mkt" are buttons, not an order.
      if (/^(?:mkt|market)$/.test(word) && !/\d/.test(line.slice((m.index ?? 0) + m[0].length))) continue;
      out.push({ value: valueOf(m[2]), raw: m[0], source: "the order's side and type" });
    }
  }
  return out;
}

// ---- 5. An orders table. Under an "Order Type" header every order row
// counts, and one whose type can't be read blocks filling (IBKR Desktop:
// "o SPY Lmit 0/10 ... GOOGL BUY Market ... IBKR BUY Market" is three
// orders, not a market order). Under a plain "Type" header only rows with
// a side do, and only if the column holds order types at all -- E*TRADE's
// option ticket has a Type column of Call / Put.
const SIDE_WORD = /\b(?:buy|sell)\b|(?:buy|sell)\s*[+-]?\d/i;
const ROW_START = /^\W*(?:[a-z]\s+)?[A-Z0-9][A-Z0-9.:!_/-]{0,14}\s/;

function fromTables(lines: string[]): Evidence[] {
  const out: Evidence[] = [];
  lines.forEach((line, i) => {
    if (!isHeader(line) || !/\btype\b/i.test(line)) return;
    const orderTypeHeader = /\bord\w{0,3}\s*type\b/i.test(line);
    const rows: Evidence[] = [];
    for (const row of lines.slice(i + 1, i + 13)) {
      if (isHeader(row)) break;
      if (orderTypeHeader) {
        if (!/\d/.test(row) || !ROW_START.test(row)) break;
      } else if (!SIDE_WORD.test(row)) {
        continue;
      }
      if (/\b(?:stop[\s-]*loss|take[\s-]*profit)\b/i.test(row) && SIDE_WORD.test(row)) {
        rows.push({ value: "stop", raw: row, source: "an exit order", exit: true });
        continue;
      }
      const t = typesIn(row)[0];
      rows.push(t ? { value: t.value, raw: row, source: "the order's row in the orders table" } : { value: "market", raw: row, source: "", unknown: true });
    }
    // A Type column that never holds an order type isn't one.
    if (!orderTypeHeader && !rows.some((r) => !r.unknown && !r.exit)) return;
    out.push(...rows);
  });
  return out;
}

const HEADER_WORDS = /\b(?:symbol|side|action|qty|quantity|status|price|time|volume|ticket|instrument|tif|dest)\b/gi;
function isHeader(line: string): boolean {
  return (line.match(HEADER_WORDS) ?? []).length >= 2;
}

/** The order type the screen states, or null. Fills in only when every
 *  statement about an entry order agrees; exits never decide it. */
export function detectOrderType(rawText: string): OrderTypeRead | null {
  const lines = rawText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const summary = orderSummary(rawText);
  const evidence: Evidence[] = [
    ...fromLabels(lines),
    ...(summary ? [{ value: summary.value, raw: summary.raw, source: "the order button / summary line" }] : []),
    ...fromOrderRows(lines),
    ...fromSideTypePhrases(lines),
    ...fromTables(lines),
  ];
  if (evidence.some((e) => e.unknown)) return null;
  const entries = evidence.filter((e) => !e.exit);
  if (entries.length === 0) return null;
  const values = new Set(entries.map((e) => e.value));
  // A stop-limit also reads as its "stop" and "limit" halves on the same
  // screen ("STP 28.03 ... LMT"); the full type wins when it is stated.
  if (values.has("stop_limit")) {
    values.delete("stop");
    values.delete("limit");
  }
  if (values.size !== 1) return null;
  const value = [...values][0];
  const first = entries.find((e) => e.value === value)!;
  return { value, raw: first.raw.slice(0, 80), source: first.source };
}
