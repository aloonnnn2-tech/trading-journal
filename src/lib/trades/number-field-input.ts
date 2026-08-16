export interface NumberFieldResult {
  text: string;
  /** Whether `value` should be propagated to the trade's stored state. */
  commit: boolean;
  value: number | null;
}

/**
 * Decides what a money field's displayed text and stored value should
 * become after a keystroke leaves the input at string `next`.
 *
 * Backs a `type="text"` input rather than `type="number"` because a native
 * number input's `.value` reports the empty string for legitimate
 * in-progress states -- typing a negative decimal like "-0.5" passes
 * through "-", "-0", "-0." along the way, and a naive
 * `value === "" ? null : ...` reads each of those as "field cleared,"
 * wiping out whatever was typed before the browser catches up.
 *
 * Returns `null` to reject a keystroke outright (a second "." or "-", or
 * any non-numeric character) -- the caller should leave the input
 * unchanged. Otherwise returns the next display text plus whether that
 * text is a complete number: `commit: false` for a legal-but-incomplete
 * prefix ("-", ".", "5.", "-5.") means update the display only and leave
 * the previously stored value alone until typing finishes.
 */
export function nextNumberFieldState(next: string): NumberFieldResult | null {
  if (next !== "" && !/^-?\d*\.?\d*$/.test(next)) return null;

  if (next === "") return { text: "", commit: true, value: null };

  if (next === "-" || next.endsWith(".")) {
    return { text: next, commit: false, value: null };
  }

  const parsed = Number(next);
  if (!Number.isFinite(parsed)) return { text: next, commit: false, value: null };

  return { text: next, commit: true, value: parsed };
}
