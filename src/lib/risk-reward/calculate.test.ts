import { describe, expect, it } from "vitest";
import { breakEvenWinRate, calculateRiskReward, MESSAGES, type RiskRewardInput } from "./calculate";

function run(overrides: Partial<RiskRewardInput>) {
  return calculateRiskReward({
    direction: "long",
    entry: 50.4,
    stop: 48,
    target: 55.2,
    shares: null,
    ...overrides,
  });
}

function ok(overrides: Partial<RiskRewardInput>) {
  const result = run(overrides);
  if (!result.ok) throw new Error(`expected a result, got error: ${result.error}`);
  return result;
}

describe("calculateRiskReward", () => {
  it("works out the default long trade: a 2R target needs a 33% win rate", () => {
    const r = ok({});
    expect(r.riskPerShare).toBeCloseTo(2.4, 9);
    expect(r.rewardPerShare).toBeCloseTo(4.8, 9);
    expect(r.rewardToRisk).toBeCloseTo(2, 9);
    expect(r.breakEvenWinRate).toBeCloseTo(1 / 3, 9);
    expect(r.stopPct).toBeCloseTo(2.4 / 50.4, 9);
    expect(r.targetPct).toBeCloseTo(4.8 / 50.4, 9);
    expect(r.dollars).toBeNull();
  });

  it("adds dollar risk and reward when shares are given", () => {
    // The journal guide's trade: 41 shares, $98.40 at risk, $196.80 at target.
    const r = ok({ shares: 41 });
    expect(r.dollars?.risk).toBeCloseTo(98.4, 9);
    expect(r.dollars?.reward).toBeCloseTo(196.8, 9);
  });

  it("works out a short trade", () => {
    const r = ok({ direction: "short", entry: 50, stop: 52, target: 44 });
    expect(r.riskPerShare).toBeCloseTo(2, 9);
    expect(r.rewardPerShare).toBeCloseTo(6, 9);
    expect(r.rewardToRisk).toBeCloseTo(3, 9);
    expect(r.breakEvenWinRate).toBeCloseTo(0.25, 9);
  });

  it("rejects a stop on the wrong side", () => {
    expect(run({ stop: 51 })).toEqual({ ok: false, error: MESSAGES.longStop });
    expect(run({ direction: "short", entry: 50, stop: 49, target: 44 })).toEqual({
      ok: false,
      error: MESSAGES.shortStop,
    });
  });

  it("rejects a target on the wrong side, or at the entry", () => {
    expect(run({ target: 49 })).toEqual({ ok: false, error: MESSAGES.longTarget });
    expect(run({ target: 50.4 })).toEqual({ ok: false, error: MESSAGES.longTarget });
    expect(run({ direction: "short", entry: 50, stop: 52, target: 51 })).toEqual({
      ok: false,
      error: MESSAGES.shortTarget,
    });
  });

  it("asks for entry, stop and target when one is missing or not above 0", () => {
    for (const field of ["entry", "stop", "target"] as const) {
      expect(run({ [field]: null })).toEqual({ ok: false, error: MESSAGES.missing });
      expect(run({ [field]: 0 })).toEqual({ ok: false, error: MESSAGES.missing });
    }
  });

  it("ignores a share count that isn't above 0", () => {
    expect(ok({ shares: 0 }).dollars).toBeNull();
    expect(ok({ shares: -5 }).dollars).toBeNull();
  });
});

describe("breakEvenWinRate", () => {
  it("matches the table on the page", () => {
    expect(breakEvenWinRate(1)).toBeCloseTo(0.5, 9);
    expect(breakEvenWinRate(1.5)).toBeCloseTo(0.4, 9);
    expect(breakEvenWinRate(2)).toBeCloseTo(1 / 3, 9);
    expect(breakEvenWinRate(3)).toBeCloseTo(0.25, 9);
  });
});
