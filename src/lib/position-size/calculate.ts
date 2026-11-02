// The math behind the public position size calculator
// (/position-size-calculator). Pure and framework-free so the page's client
// component and the unit tests run exactly the same code.
//
// Sizing is by risk, not by money: the trader picks how much of the account
// they are willing to lose if the stop is hit, and the share count falls out
// of the distance between entry and stop. `sign` folds long and short into
// one set of formulas -- every price distance is measured in the direction
// the trade makes money.

export type Direction = "long" | "short";

export interface PositionSizeInput {
  direction: Direction;
  /** Account size in dollars. null = the field is empty or not a number. */
  account: number | null;
  /** Risk per trade as a percentage of the account: 1 means 1%. */
  riskPct: number | null;
  entry: number | null;
  stop: number | null;
  /** Optional. null (or not above 0) means no target was given. */
  target: number | null;
}

export interface LevelRow {
  label: string;
  price: number;
  /** Profit or loss in dollars for the whole position at this price. */
  pnl: number;
}

export type TargetResult =
  | { kind: "none" }
  | { kind: "wrong-side" }
  | { kind: "ok"; rewardToRisk: number; profitAtTarget: number };

export type PositionSizeResult =
  | { ok: false; error: string }
  | {
      ok: true;
      shares: number;
      maxRisk: number;
      /** 1R: what one share loses if the stop is hit. */
      riskPerShare: number;
      actualRisk: number;
      positionValue: number;
      /** A fraction: 0.2 means the position is 20% of the account. */
      positionPctOfAccount: number;
      target: TargetResult;
      levels: LevelRow[];
      warnings: string[];
    };

export const MESSAGES = {
  missing: "Fill in account size, risk %, entry and stop.",
  longStop: "For a long trade, the stop must be below the entry.",
  shortStop: "For a short trade, the stop must be above the entry.",
  tooWide: "Your stop is too wide for this risk amount: not even 1 share fits.",
  margin: "This position is bigger than your account and would need margin.",
} as const;

// Added before flooring. 100 / (10.30 - 10.20) is 999.99999999998578 in
// binary floating point, so a bare floor sizes the trade one share short.
const EPSILON = 1e-9;

function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const { direction, account, riskPct, entry, stop, target } = input;

  if (!positive(account) || !positive(riskPct) || !positive(entry) || !positive(stop)) {
    return { ok: false, error: MESSAGES.missing };
  }
  if (direction === "long" && stop >= entry) return { ok: false, error: MESSAGES.longStop };
  if (direction === "short" && stop <= entry) return { ok: false, error: MESSAGES.shortStop };

  const sign = direction === "long" ? 1 : -1;
  const maxRisk = (account * riskPct) / 100;
  const riskPerShare = (entry - stop) * sign;
  const shares = Math.floor(maxRisk / riskPerShare + EPSILON);
  const actualRisk = shares * riskPerShare;
  const positionValue = shares * entry;
  const positionPctOfAccount = positionValue / account;

  let targetResult: TargetResult = { kind: "none" };
  if (positive(target)) {
    const reward = (target - entry) * sign;
    targetResult =
      reward > 0
        ? { kind: "ok", rewardToRisk: reward / riskPerShare, profitAtTarget: reward * shares }
        : { kind: "wrong-side" };
  }

  const levels: LevelRow[] = [
    { label: "Stop (−1R)", price: stop, pnl: -actualRisk },
    ...[1, 2, 3].map((n) => ({
      label: `${n}R`,
      price: entry + sign * n * riskPerShare,
      pnl: n * actualRisk,
    })),
  ];

  const warnings: string[] = [];
  if (shares === 0) warnings.push(MESSAGES.tooWide);
  if (positionValue > account) warnings.push(MESSAGES.margin);

  return {
    ok: true,
    shares,
    maxRisk,
    riskPerShare,
    actualRisk,
    positionValue,
    positionPctOfAccount,
    target: targetResult,
    levels,
    warnings,
  };
}
