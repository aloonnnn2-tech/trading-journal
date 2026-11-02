// The math behind the public risk/reward calculator (/risk-reward-calculator).
// Pure, so the page's client component and the unit tests run the same code.
//
// Same conventions as src/lib/position-size/calculate.ts: `sign` folds long
// and short into one set of formulas, measuring every distance in the
// direction the trade makes money.

import { MESSAGES as SIZE_MESSAGES, type Direction } from "@/lib/position-size/calculate";

export interface RiskRewardInput {
  direction: Direction;
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** Optional. With it, the result also carries dollar risk and reward. */
  shares: number | null;
}

export type RiskRewardResult =
  | { ok: false; error: string }
  | {
      ok: true;
      riskPerShare: number;
      rewardPerShare: number;
      /** 2 means the target is worth twice what the stop costs. */
      rewardToRisk: number;
      /** A fraction: 0.333 means you need to win a third of trades to break even. */
      breakEvenWinRate: number;
      /** Distance to the stop as a fraction of the entry price. */
      stopPct: number;
      targetPct: number;
      dollars: { risk: number; reward: number } | null;
    };

export const MESSAGES = {
  missing: "Fill in entry, stop and target.",
  longStop: SIZE_MESSAGES.longStop,
  shortStop: SIZE_MESSAGES.shortStop,
  longTarget: "For a long trade, the target must be above the entry.",
  shortTarget: "For a short trade, the target must be below the entry.",
} as const;

/** The win rate at which wins and losses cancel out, ignoring costs:
 *  win% × R:R = (1 − win%) × 1, so win% = 1 / (1 + R:R). */
export function breakEvenWinRate(rewardToRisk: number): number {
  return 1 / (1 + rewardToRisk);
}

function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

export function calculateRiskReward(input: RiskRewardInput): RiskRewardResult {
  const { direction, entry, stop, target, shares } = input;

  if (!positive(entry) || !positive(stop) || !positive(target)) {
    return { ok: false, error: MESSAGES.missing };
  }
  const long = direction === "long";
  if (long && stop >= entry) return { ok: false, error: MESSAGES.longStop };
  if (!long && stop <= entry) return { ok: false, error: MESSAGES.shortStop };
  if (long && target <= entry) return { ok: false, error: MESSAGES.longTarget };
  if (!long && target >= entry) return { ok: false, error: MESSAGES.shortTarget };

  const sign = long ? 1 : -1;
  const riskPerShare = (entry - stop) * sign;
  const rewardPerShare = (target - entry) * sign;
  const rewardToRisk = rewardPerShare / riskPerShare;

  return {
    ok: true,
    riskPerShare,
    rewardPerShare,
    rewardToRisk,
    breakEvenWinRate: breakEvenWinRate(rewardToRisk),
    stopPct: riskPerShare / entry,
    targetPct: rewardPerShare / entry,
    dollars: positive(shares) ? { risk: riskPerShare * shares, reward: rewardPerShare * shares } : null,
  };
}
