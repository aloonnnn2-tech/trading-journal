// Confidence helpers. Most of a field's confidence is set at extraction time
// (OCR confidence × label-match strength in semantic.ts); this module holds the
// shared clamp plus the multipliers validation applies when a check passes or
// fails, so the tuning lives in one place.

export const CONF = {
  /** Multiplier applied when a value passes a plausibility check. */
  passBoost: 1.05,
  /** Multiplier when a soft check fails (kept, but demoted). */
  softFail: 0.5,
  /** Multiplier when cross-validation (e.g. Entry×Shares≈Size) agrees. */
  crossAgree: 1.1,
  /** Multiplier when cross-validation disagrees. */
  crossDisagree: 0.6,
} as const;

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function adjust(confidence: number, multiplier: number): number {
  return clamp01(confidence * multiplier);
}
