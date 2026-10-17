import { z } from "zod";
import { fetchYahooCandles, fetchYahooNews, type Candle, type YahooNewsItem } from "@/lib/market-data/yahoo";
import { UpstreamUnavailableError } from "@/lib/http/resilient-fetch";
import { takeYahooSlot } from "@/lib/rate-limits/daily";

// Tools beyond the journal, so Ask can answer more than "what does my data
// say" (Alon, 2026-10-16: no restrictions but security ones):
//
//  - calculate: exact arithmetic. Models are unreliable at it; position
//    sizing and what-if P/L must not be off by a digit.
//  - get_market_data: a ticker's current quote and price history, through the
//    same Yahoo client the chart uses (timeouts, retries, circuit breaker,
//    the app-wide Yahoo ceiling).
//
// Neither touches the database or the user's data. calculate is a tiny
// parser, never eval: an expression can only ever be arithmetic.

// ---- calculate --------------------------------------------------------------

export const calculateSchema = z.object({ expression: z.string().min(1).max(500) });

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: (x, digits = 0) => Math.round(x * 10 ** digits) / 10 ** digits,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  pow: Math.pow,
};

/**
 * Evaluates arithmetic: numbers (1,234.5 written as 1234.5), + - * / ^ %,
 * parentheses, and the functions above. Throws on anything else.
 */
export function evaluateExpression(expression: string): number {
  const tokens = expression.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-z]+|[-+*/^%(),]/gi);
  const compact = expression.replace(/\s+/g, "");
  if (!tokens || tokens.join("") !== compact) throw new Error("Only numbers, + - * / ^ %, parentheses and math functions are allowed.");
  let i = 0;
  const peek = () => tokens[i];
  const take = (expected?: string) => {
    const t = tokens[i++];
    if (expected && t !== expected) throw new Error(`Expected "${expected}".`);
    return t;
  };

  function primary(): number {
    const t = peek();
    if (t === undefined) throw new Error("Unexpected end of expression.");
    if (t === "(") {
      take("(");
      const v = sum();
      take(")");
      return v;
    }
    if (t === "-") {
      take();
      return -power();
    }
    if (t === "+") {
      take();
      return power();
    }
    if (/^[a-z]+$/i.test(t)) {
      const name = take().toLowerCase();
      if (name === "pi") return Math.PI;
      const fn = FUNCTIONS[name];
      if (!fn) throw new Error(`Unknown function "${name}".`);
      take("(");
      const args = [sum()];
      while (peek() === ",") {
        take(",");
        args.push(sum());
      }
      take(")");
      return fn(...args);
    }
    const n = Number(take());
    if (!Number.isFinite(n)) throw new Error(`Not a number: "${t}".`);
    return n;
  }
  function power(): number {
    const base = primary();
    if (peek() === "^") {
      take();
      return base ** power();
    }
    return base;
  }
  function product(): number {
    let v = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = take();
      const r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function sum(): number {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = take();
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const value = sum();
  if (i !== tokens.length) throw new Error(`Unexpected "${tokens[i]}".`);
  if (!Number.isFinite(value)) throw new Error("The result is not a finite number (division by zero?).");
  return value;
}

export function calculate(args: z.infer<typeof calculateSchema>) {
  try {
    return { expression: args.expression, result: evaluateExpression(args.expression) };
  } catch (err) {
    return { expression: args.expression, error: (err as Error).message };
  }
}

// ---- get_market_data ----------------------------------------------------------

const RANGES = ["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"] as const;
const SYMBOL = /^[A-Z0-9.\-=^]{1,20}$/;
/** A long history is sampled down to this many bars, so it stays a readable result. */
const MAX_BARS = 120;

export const getMarketDataSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  range: z.enum(RANGES).optional(),
  /** Also return recent headlines (titles only). */
  news: z.boolean().optional(),
});

/** Headlines returned with news: true -- titles are short, so this is plenty. */
const MAX_HEADLINES = 8;

type News =
  | { headlines: (YahooNewsItem & { about_this_symbol: boolean })[]; source: string; note: string }
  | { unavailable: string };

async function newsFor(symbol: string): Promise<News> {
  if (!(await takeYahooSlot())) return { unavailable: "News lookups are busy right now." };
  try {
    const items = await fetchYahooNews(symbol, MAX_HEADLINES);
    if (!items) return { unavailable: "News is unavailable right now." };
    return {
      headlines: items.map((i) => ({ ...i, about_this_symbol: i.related.includes(symbol) })),
      source: "Yahoo Finance search (unofficial): headlines and links only, no article text",
      note: items.length
        ? "Only the titles are known -- say so rather than describing what an article says."
        : "No recent headlines found.",
    };
  } catch {
    // Never throws: it runs alongside the price fetch, and a failed price
    // lookup returns before awaiting it.
    return { unavailable: "News is temporarily unavailable." };
  }
}

/** Every nth bar, always keeping the last one. */
export function sampleBars<T>(bars: T[], max: number): T[] {
  if (bars.length <= max) return bars;
  const step = Math.ceil(bars.length / max);
  const out = bars.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== bars[bars.length - 1]) out.push(bars[bars.length - 1]);
  return out;
}

/**
 * `outputBudget` is the tier's ceiling on one tool result. Three months of
 * daily bars run past a free tier's, and an over-budget result reaches the
 * model as an error -- so "what do you think of NVDA?" failed outright on a
 * free key (found by the Ask benchmark, 2026-10-17). The bars thin out to fit.
 *
 * News rides along on the same call (`news: true`) rather than being its
 * own tool: "what do you think of NVDA?" wants both, and a free key gets
 * three lookups per question (Alon chose Yahoo headlines, 2026-10-17).
 */
export async function getMarketData(args: z.infer<typeof getMarketDataSchema>, outputBudget = Infinity) {
  const symbol = args.symbol.toUpperCase();
  if (!SYMBOL.test(symbol)) return { error: `"${args.symbol}" isn't a valid ticker symbol.` };
  const range = args.range ?? "3mo";
  if (!(await takeYahooSlot())) return { error: "Market data is busy right now; try again in a minute." };

  const news = args.news ? newsFor(symbol) : null;
  let result;
  try {
    result = await fetchYahooCandles(symbol, { range, revalidate: 300 });
  } catch (err) {
    if (err instanceof UpstreamUnavailableError) return { error: "Market data is temporarily unavailable." };
    throw err;
  }
  if (!result || result.candles.length === 0) {
    return { error: `No price data for "${symbol}". Crypto is like BTC-USD, forex like EURUSD=X, indices like ^GSPC.` };
  }

  const candles: Candle[] = result.candles;
  const first = candles[0];
  const last = candles[candles.length - 1];
  const out = {
    symbol,
    source: "Yahoo Finance (unofficial; quotes may be delayed)",
    quote: {
      price: result.currentPrice,
      day_high: result.dayHigh,
      day_low: result.dayLow,
      as_of: result.quoteTime ? result.quoteTime.toISOString() : null,
    },
    range: {
      span: range,
      from: first.time,
      to: last.time,
      change_pct: first.close ? Number((((last.close - first.close) / first.close) * 100).toFixed(2)) : null,
      high: Math.max(...candles.map((c) => c.high)),
      low: Math.min(...candles.map((c) => c.low)),
    },
    daily_bars: sampleBars(candles, MAX_BARS),
    bars_sampled: candles.length > MAX_BARS,
    ...(news ? { news: await news } : {}),
  };
  // Leave room for the envelope the executor wraps around a result.
  const fits = () => JSON.stringify(out).length <= outputBudget * 0.9;
  for (let max = MAX_BARS; !fits() && max > 8; ) {
    max = Math.floor(max / 2);
    out.daily_bars = sampleBars(candles, max);
    out.bars_sampled = candles.length > max;
  }
  // Still too big: fewer headlines, newest kept (Yahoo lists newest first).
  while (!fits() && out.news && "headlines" in out.news && out.news.headlines.length > 2) {
    out.news.headlines = out.news.headlines.slice(0, out.news.headlines.length - 2);
  }
  return out;
}
