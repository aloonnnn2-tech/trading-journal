// Label recognition: map noisy OCR label text onto canonical field keys,
// tolerating the character errors OCR makes ("Entrv" -> "Entry", "S/L" ->
// "Stop Loss"). Also holds the ticker blocklist and direction/status keyword
// logic ported and expanded from the previous regex parser.

import type { FieldKey } from "./types";
import { normalizeLabel, NUM_RE } from "./normalize";

interface LabelDef {
  key: FieldKey;
  aliases: string[];
}

// Order matters only for tie-breaking; more specific labels first.
//
// Aliases are real broker terminology, gathered across the app's supported
// broker list (TradingView, MT4/5, IBKR, ThinkorSwim, Robinhood, Webull,
// TradeLocker, Tradovate, NinjaTrader, Binance, Bybit, Kraken, Coinbase,
// KuCoin, MEXC, Schwab, Fidelity, E*TRADE) plus common trader shorthand.
// Deliberately excluded, with the reason, so future additions don't
// reintroduce a known false-positive:
//   - "volume"/"vol" under shares — collides with a chart's Volume indicator
//     label (e.g. "Vol 62" under a candlestick), which sits right next to an
//     unrelated number and would get misread as quantity.
//   - "market price" under entry_price — in every broker examined, "Market
//     Price"/"Mark Price" names the live/current price, not what you paid;
//     it stays solely under current_price. ("Price" alone still falls back to
//     entry via the anchored bare-"price" heuristic in semantic.ts.)
//   - a bare "market" under the `market` field — collides with the
//     Market/Limit/Stop order-type tab.
//   - bare "time"/"date" under entry_date — collides with "Time in force",
//     date-column table headers, etc.
const LABEL_DEFS: LabelDef[] = [
  {
    key: "stop_loss",
    aliases: [
      "stop loss", "stoploss", "stop-loss", "s/l", "sl", "sl price", "s/l price", "stop", "stop price",
      "protective stop", "initial stop", "hard stop", "stop out", "stop @", "close stop", "risk stop",
      "cut loss", "cut loss at", "max loss", "loss limit", "downside", "exit stop",
    ],
  },
  {
    key: "take_profit",
    aliases: [
      "take profit", "takeprofit", "take-profit", "t/p", "tp", "tp price", "t/p price", "profit target",
      "target", "target price", "tgt", "limit price", "exit target", "reward target", "profit taking",
      "close target", "upside", "take profit at", "profit price",
    ],
  },
  {
    key: "entry_price",
    aliases: [
      "entry", "entry price", "entry point", "entry px", "avg entry", "avg entry price", "average entry",
      "avg fill", "avg fill price", "avg exec price", "fill price", "fill px", "filled at", "filled price",
      "fill", "open price", "opening price", "opened at", "position entry", "trade price", "in at",
      "entered at", "long entry", "short entry", "buy fill", "sell fill",
      "bought at", "sold at short", "buy price", "sell price short", "buy in", "purchase price",
      "cost basis", "cost per share", "basis", "execution price", "exec price", "order price",
    ],
  },
  {
    key: "exit_price",
    aliases: [
      "exit", "exit price", "exit px", "close price", "closing price", "closed at", "sold at", "sell price",
      "covered at", "cover price", "position exit", "closeout price", "liquidated at",
    ],
  },
  {
    key: "average_price",
    aliases: ["average price", "avg price", "avg cost", "average cost", "avg cost basis", "vwap entry", "cost average"],
  },
  {
    key: "current_price",
    aliases: [
      "current price", "last price", "last", "market price", "mark price", "ltp", "mark", "spot price",
      "index price", "live price", "quote", "last traded price", "current value", "mid price",
    ],
  },
  {
    key: "shares",
    aliases: [
      "shares", "share", "qty", "quantity", "contracts", "contract", "units", "size", "lot size", "lot",
      "lots", "qty filled", "filled qty", "order size", "trade size", "position qty", "number of shares",
      "no of shares", "shares traded",
    ],
  },
  {
    key: "position_size",
    aliases: ["position size", "position value", "notional", "notional value", "market value", "trade value", "cost value", "exposure"],
  },
  {
    key: "dollar_amount",
    aliases: ["dollar amount", "total", "total cost", "total value", "value", "invested", "capital", "trade amount", "amount invested", "total invested"],
  },
  {
    key: "risk_amount",
    aliases: ["risk", "risk amount", "risk $", "max risk", "amount at risk", "$risk", "capital at risk", "risk exposure", "dollar risk"],
  },
  {
    key: "risk_percent",
    aliases: ["risk %", "risk percent", "risk pct", "% risk", "account risk", "portfolio risk", "position risk"],
  },
  {
    key: "pnl_amount",
    aliases: [
      "pnl", "p&l", "p/l", "profit", "profit/loss", "profit loss", "gain", "gain/loss", "realized pnl",
      "unrealized pnl", "net pnl", "p&l $", "floating p/l", "floating pnl", "open profit", "net profit",
      "total pnl", "realized p/l", "unrealized p/l",
    ],
  },
  {
    key: "pnl_percent",
    aliases: ["pnl %", "p&l %", "return", "return %", "roi", "gain %", "profit %", "%", "percent return", "yield"],
  },
  {
    key: "risk_reward_ratio",
    aliases: ["risk reward", "risk/reward", "r/r", "rr", "r:r", "reward risk", "reward:risk", "payoff ratio"],
  },
  { key: "ticker", aliases: ["ticker", "symbol", "instrument", "asset", "pair", "underlying"] },
  { key: "company_name", aliases: ["company", "name", "company name", "issuer"] },
  // NB: no bare "market" alias — it collides with the order-type "Market" tab.
  { key: "market", aliases: ["exchange", "venue"] },
  { key: "asset_type", aliases: ["asset type", "type", "security type", "instrument type", "product"] },
  { key: "order_type", aliases: ["order type", "order", "type of order"] },
  { key: "status", aliases: ["status", "order status", "state"] },
  // No bare "time"/"date" — they match "Time in force", date-column headers, etc.
  {
    key: "entry_date",
    aliases: [
      "entry date", "open date", "opened", "date opened", "open time", "entry time", "execution time",
      "filled time", "trade date", "position opened", "filled on", "order date",
    ],
  },
  {
    key: "exit_date",
    aliases: ["exit date", "close date", "closed", "date closed", "close time", "exit time", "position closed", "closed on"],
  },
  { key: "broker", aliases: ["broker", "brokerage", "platform"] },
  { key: "account", aliases: ["account", "acct", "account #", "account number", "account id"] },
  { key: "exchange", aliases: ["exchange"] },
  { key: "currency", aliases: ["currency", "ccy", "quote currency"] },
  { key: "order_id", aliases: ["order id", "order #", "order number", "reference", "ref", "confirmation", "trade id", "ticket"] },
];

// Precompute normalized aliases once.
const NORMALIZED: { key: FieldKey; alias: string }[] = LABEL_DEFS.flatMap((def) =>
  def.aliases.map((alias) => ({ key: def.key, alias: normalizeLabel(alias) })),
);

/** Levenshtein distance, capped early for speed. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Similarity ratio in 0..1 (1 = identical). */
function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export interface LabelMatch {
  key: FieldKey;
  /** Match strength 0..1. Exact = 1. */
  score: number;
  /** The alias that matched, for logging. */
  alias: string;
}

/**
 * Find the best canonical field for a label fragment. Tries exact and prefix
 * matches first, then fuzzy matching to absorb OCR errors. Short fragments
 * demand a higher bar so "SL"/"TP" don't fuzzy-match everything.
 */
export function matchLabel(fragment: string): LabelMatch | null {
  const norm = normalizeLabel(fragment);
  if (!norm) return null;

  let best: LabelMatch | null = null;
  for (const { key, alias } of NORMALIZED) {
    let score: number;
    if (norm === alias) {
      score = 1;
    } else if (norm.startsWith(alias + " ") || norm.endsWith(" " + alias)) {
      score = 0.95;
    } else {
      score = ratio(norm, alias);
    }
    // Short aliases (<=2 chars, e.g. "sl") only count on an exact match — fuzzy
    // matching on 2 chars is meaningless.
    if (alias.length <= 2 && score < 1) continue;
    const threshold = alias.length <= 4 ? 0.86 : 0.8;
    if (score >= threshold && (!best || score > best.score)) {
      best = { key, score, alias };
    }
  }
  return best;
}

/**
 * Find every known label phrase inside a longer line, in left-to-right
 * order — for a multi-column summary row OCR merges onto one line
 * ("Market Value Total Cost Average Price"). The paired value line
 * ("667.50  1,000.00  9.70") gets split into that many numbers and zipped
 * with these positionally, since line-level OCR gives no per-word
 * coordinates to align columns by position instead.
 *
 * Deliberately literal substring matching, not fuzzy: multi-column headers
 * tend to OCR cleanly (they're short, common words), and fuzzy-scanning
 * every alias at every substring position would be slow and prone to
 * spurious overlapping matches. Returns null unless 2+ *different* fields
 * are found — a single field matched twice by overlapping aliases (e.g.
 * "stop" and "stop loss" both inside "Stop Loss, Price") is one column, not
 * two, and must not be counted as a multi-column row.
 */
export function splitMultiLabel(text: string): { key: FieldKey; alias: string }[] | null {
  const norm = normalizeLabel(text);
  if (!norm) return null;

  const found: { key: FieldKey; alias: string; index: number }[] = [];
  // Longest alias first, so "average price" claims its span before a
  // shorter alias could carve out a false match inside it.
  const byLengthDesc = [...NORMALIZED].sort((a, b) => b.alias.length - a.alias.length);
  for (const { key, alias } of byLengthDesc) {
    // Same floor as matchLabel's own fuzzy matching — only 1-2 char aliases
    // ("sl","tp") are too ambiguous; "qty"/"ref" etc. are fine as literal
    // substrings.
    if (alias.length <= 2) continue;
    // Only the first (longest) alias hit per field counts — a second,
    // shorter alias for the same key just means the label repeated itself,
    // not a second column.
    if (found.some((f) => f.key === key)) continue;
    const idx = norm.indexOf(alias);
    if (idx === -1) continue;
    const end = idx + alias.length;
    if (found.some((f) => idx < f.index + f.alias.length && end > f.index)) continue;
    found.push({ key, alias, index: idx });
  }
  if (found.length < 2) return null;
  found.sort((a, b) => a.index - b.index);
  return found.map(({ key, alias }) => ({ key, alias }));
}

// ---------------------------------------------------------------------------
// Ticker detection
// ---------------------------------------------------------------------------

// Uppercase tokens that look like tickers but never are (2-10 chars).
export const TICKER_BLOCKLIST = new Set([
  "BUY", "SELL", "LONG", "SHORT", "USD", "USDT", "USDC", "EUR", "GBP", "JPY", "QTY", "PNL", "AVG", "DAY",
  "EST", "MIN", "MAX", "THE", "AND", "FOR", "ALL", "NEW", "NET", "REF", "SL", "TP", "RR", "ATR", "EMA",
  "SMA", "RSI", "MACD", "VOL", "OHL", "OCH", "ETF", "CEO", "IPO", "SEC", "NYSE", "AMEX", "OTC", "FX",
  "OPEN", "HIGH", "LOW", "LAST", "VWAP", "PRE", "AH", "PM", "AM", "BOT", "SLD", "GTC", "GTD", "IOC",
  "LMT", "MKT", "STP", "ORDER", "STATUS", "FILLED", "STOP", "LOSS", "TAKE", "PROFIT", "PRICE", "ENTRY",
  "EXIT", "MARK", "SIZE", "COST", "TIME", "DATE", "TOTAL", "VALUE", "LIMIT", "MARKET", "SHARES", "SHARE",
  "POSITION", "PERP", "PERPETUAL", "INC", "CORP", "LTD", "PLC", "CO", "ISOLATED", "CROSS", "ROI",
  "MARGIN", "LIQ", "FEE", "FEES", "COMM", "LEV", "UNREALIZED", "REALIZED", "DOM", "SMART", "RTH", "ASK",
  "BID", "TIF", "TICK", "TICKS", "PIPS", "RISK", "REWARD", "TARGET", "ACCOUNT", "BALANCE", "EQUITY",
  "IN", "ON", "AT", "TO", "BY", "OR", "IF", "IS", "IT", "BE", "DO", "GO", "NO", "OK", "UP", "PL",
]);

/** Tidy a raw ticker: drop a leading "$", and reduce a dated/option symbol to
 * its underlying ("SPY250214C603" / "SPY2502" -> "SPY"). */
function cleanTicker(raw: string): string {
  const t = raw.replace(/^\$+/, "").toUpperCase();
  const underlying = t.match(/^([A-Z]{1,6})\d/);
  if (underlying && !TICKER_BLOCKLIST.has(underlying[1])) return underlying[1];
  return t;
}

/** Extract a ticker symbol from a set of OCR line texts, top to bottom. */
export function findTicker(texts: string[]): { value: string; source: string } | null {
  const joined = texts.join("\n");

  // 1. Exchange-qualified: "NASDAQ:AAPL", "BINANCE:BTCUSDT"
  const qualified = joined.match(/\b([A-Z]{2,10})\s*:\s*([A-Z0-9]{1,10})\b/);
  if (qualified && !TICKER_BLOCKLIST.has(qualified[2])) {
    return { value: cleanTicker(qualified[2]), source: `exchange-qualified (${qualified[1]}:)` };
  }

  // 2. Fill / terminal notation: "BOT 100 AAPL @", "EURUSD, buy"
  const fill = joined.match(/\b(?:bot|sld|bought|sold)\b[\s\d,.]*\b([A-Z][A-Z0-9]{1,9})\b/i);
  if (fill && /^[A-Z0-9]+$/.test(fill[1]) && !TICKER_BLOCKLIST.has(fill[1].toUpperCase())) {
    return { value: cleanTicker(fill[1]), source: "fill notation" };
  }
  const mtStyle = joined.match(/\b([A-Z][A-Z0-9]{1,9})\s*,\s*(?:buy|sell)\b/i);
  if (mtStyle && /^[A-Z0-9]+$/.test(mtStyle[1]) && !TICKER_BLOCKLIST.has(mtStyle[1].toUpperCase())) {
    return { value: cleanTicker(mtStyle[1]), source: "MT4/5 symbol notation" };
  }

  // 3. First all-caps token scanning top-down — headers name the symbol first.
  for (const line of texts) {
    const tokens = line.match(/\b[A-Z][A-Z0-9]{1,9}\b/g) ?? [];
    for (const t of tokens) {
      if (!TICKER_BLOCKLIST.has(t)) return { value: cleanTicker(t), source: "header symbol" };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Direction & status keywords
// ---------------------------------------------------------------------------

export function findDirection(texts: string[]): { value: "long" | "short"; source: string } | null {
  // "Limit Sell" / "Sell Limit" describe an exit order, not the trade direction.
  let joined = texts.join("\n").replace(/\b(?:limit\s+sell|sell\s+limit|stop\s+sell|sell\s+stop)\b/gi, " ");
  // A two-sided quote ("Sell 61.73  Buy 61.73") shows both sides of the
  // market, not the order's own direction — buy/sell always appear together
  // there, which would otherwise make this always read as "long" (buy is
  // checked first). Strip it before scanning for a real direction keyword.
  // NUM_RE has top-level `|` alternation, so every embedding here must wrap it
  // in its own group — otherwise the alternation "leaks" out and silently
  // splits this whole pattern into unintended alternatives.
  const quoteRow = new RegExp(
    String.raw`\b(?:sell\b[^\n]{0,20}(?:${NUM_RE})[^\n]{0,20}\bbuy|buy\b[^\n]{0,20}(?:${NUM_RE})[^\n]{0,20}\bsell)\b[^\n]{0,20}(?:${NUM_RE})`,
    "gi",
  );
  joined = joined.replace(quoteRow, " ");
  // Options phrasing: opening a position is the direction; closing one isn't.
  // (Deliberately not inferring direction from "call"/"put" alone — a call can
  // be bought or sold, so the option type doesn't reliably say which.)
  if (/\bbuy\s+to\s+open\b/i.test(joined)) return { value: "long", source: "direction keyword" };
  if (/\bsell\s+to\s+open\b/i.test(joined)) return { value: "short", source: "direction keyword" };
  if (/\b(?:long|buy|bought|bot)\b/i.test(joined)) return { value: "long", source: "direction keyword" };
  if (/\b(?:short|sell|sold|sld)\b/i.test(joined)) return { value: "short", source: "direction keyword" };
  return null;
}

export function findStatus(
  texts: string[],
): { value: "pending" | "open" | "closed"; source: string } | null {
  const joined = texts.join("\n").toLowerCase();
  if (/\b(pending|working|submitted|queued)\b/.test(joined)) return { value: "pending", source: "status keyword" };
  // Bare "filled" must not match "Filled Qty" / "Qty Filled" — that names a
  // field (how many shares got filled), not the trade's own status.
  const withoutFilledQty = joined.replace(/\b(?:filled\s+qty|qty\s+filled)\b/g, "");
  if (/\b(closed|realized|executed)\b/.test(joined) || /\bfilled\b/.test(withoutFilledQty)) {
    return { value: "closed", source: "status keyword" };
  }
  if (/\b(open|active|unrealized|running)\b/.test(joined)) return { value: "open", source: "status keyword" };
  return null;
}
