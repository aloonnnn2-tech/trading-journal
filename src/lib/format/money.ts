// One formatter for every money figure the app shows.
//
// **The bug this exists to prevent.** Before this module there were eleven
// private `money()` helpers plus a dozen hand-built `$${n.toFixed(2)}`
// strings, and they disagreed: the dashboard said `$78,622`, Analytics said
// `$13621.59`, the strategy scorecard said `+$8475.82`, and the trade table
// said `$-1360.21` with the sign on the wrong side of the symbol. Four
// renderings of the same quantity reads as four different quantities.
//
// Locale is pinned to en-US rather than left as `undefined`. `undefined`
// means "whatever locale the runtime has", which is the Netlify server on the
// first paint and the visitor's browser on hydration -- the same
// server/client split that src/lib/dates/format.ts documents.
//
// This is presentation only. Nothing here computes a statistic; those all
// come from src/lib/segments/engine.ts.

/** U+2212 MINUS SIGN, not U+002D HYPHEN-MINUS. It is the width of a digit,
 *  so a column of figures stays aligned, and it is what the UI already used
 *  in most places. */
const MINUS = "−";

export interface MoneyOptions {
  /**
   * `"negative"` (default) signs losses only: `$8,475.82` / `−$1,360.21`.
   * `"always"` also signs gains: `+$8,475.82` / `−$1,360.21`. Use it where a
   * figure is a change rather than a balance -- P/L, not account cash.
   */
  sign?: "always" | "negative";
  /**
   * ISO 4217 code. Defaults to USD: the app stores no account currency (no
   * column on `user_settings` or `trades`), so USD is the only honest answer
   * today. The option exists so that adding the setting later is a change at
   * the call sites, not a rewrite of this module.
   */
  currency?: string;
  /** Rendered for null / undefined / NaN / Infinity. */
  placeholder?: string;
  /**
   * Axis-tick mode: `$13.6K` instead of `$13,621.59`. Chart Y axes are 56-60px
   * wide and the full format does not fit. Never use it for a figure a reader
   * might act on -- it hides cents and rounds hard.
   */
  compact?: boolean;
}

const cache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // Constructing an Intl.NumberFormat is the expensive part; formatting with
  // one is cheap. Tables render hundreds of figures per page.
  const made = new Intl.NumberFormat(
    "en-US",
    compact
      ? {
          style: "currency",
          currency,
          notation: "compact",
          compactDisplay: "short",
          maximumFractionDigits: 1,
        }
      : {
          style: "currency",
          currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        },
  );
  cache.set(key, made);
  return made;
}

/**
 * Format a money amount: thousands separators, two decimals, and the sign
 * before the currency symbol.
 *
 *   formatMoney(13621.59)                      // "$13,621.59"
 *   formatMoney(-1360.21)                      // "−$1,360.21"
 *   formatMoney(8475.82, { sign: "always" })   // "+$8,475.82"
 *   formatMoney(null)                          // "—"
 *
 * Note on rounding: this rounds half away from zero on the *decimal* form of
 * the number, so `1.005` gives `$1.01`. That differs from the `toFixed(2)`
 * this module replaced, which rounds the binary double (1.005 is really
 * 1.00499999999999989...) and so gave `$1.00`. Intl's answer is the one a
 * reader expects, and no rounding mode is applied on top of it -- half-cent
 * amounts are rare in P/L and correcting for them would only move the
 * disagreement somewhere less visible.
 */
export function formatMoney(value: number | null | undefined, options: MoneyOptions = {}): string {
  const { sign = "negative", currency = "USD", placeholder = "—", compact = false } = options;

  if (value == null || !Number.isFinite(value)) return placeholder;

  // Format the magnitude and prepend the sign ourselves. Intl's own
  // `signDisplay` does put the sign before the symbol, but it emits U+002D
  // and has no way to ask for U+2212.
  const body = formatter(currency, compact).format(Math.abs(value));

  // Decide the sign from what was *rendered*, not from the input. -0.004
  // rounds to "$0.00", and "−$0.00" claims a loss the figure does not show.
  // A body with no non-zero digit is a zero at this precision, whatever the
  // currency symbol or code around it looks like.
  if (!/[1-9]/.test(body)) return body;

  if (value < 0) return MINUS + body;
  return sign === "always" ? "+" + body : body;
}
