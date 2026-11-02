import { describe, expect, it } from "vitest";
import { calculatePositionSize, MESSAGES, type PositionSizeInput } from "./calculate";

function run(overrides: Partial<PositionSizeInput>) {
  return calculatePositionSize({
    direction: "long",
    account: 10000,
    riskPct: 1,
    entry: 50.4,
    stop: 48,
    target: 55.2,
    ...overrides,
  });
}

function ok(overrides: Partial<PositionSizeInput>) {
  const result = run(overrides);
  if (!result.ok) throw new Error(`expected a result, got error: ${result.error}`);
  return result;
}

describe("calculatePositionSize", () => {
  it("sizes the default long trade", () => {
    const r = ok({});
    expect(r.shares).toBe(41);
    expect(r.maxRisk).toBeCloseTo(100, 9);
    expect(r.riskPerShare).toBeCloseTo(2.4, 9);
    expect(r.actualRisk).toBeCloseTo(98.4, 9);
    expect(r.positionValue).toBeCloseTo(2066.4, 9);
    expect(r.positionPctOfAccount).toBeCloseTo(0.20664, 9);
    expect(r.target.kind).toBe("ok");
    if (r.target.kind === "ok") {
      expect(r.target.rewardToRisk).toBeCloseTo(2, 9);
      expect(r.target.profitAtTarget).toBeCloseTo(196.8, 9);
    }
    expect(r.levels.map((l) => l.label)).toEqual(["Stop (−1R)", "1R", "2R", "3R"]);
    expect(r.levels[0].price).toBe(48);
    expect(r.levels[0].pnl).toBeCloseTo(-98.4, 9);
    expect(r.levels[2].price).toBeCloseTo(55.2, 9);
    expect(r.levels[2].pnl).toBeCloseTo(196.8, 9);
    expect(r.warnings).toEqual([]);
  });

  it("sizes a short trade, with levels below the entry", () => {
    const r = ok({ direction: "short", entry: 50, stop: 52, target: 46 });
    expect(r.shares).toBe(50);
    expect(r.actualRisk).toBeCloseTo(100, 9);
    expect(r.target.kind === "ok" && r.target.rewardToRisk).toBeCloseTo(2, 9);
    expect(r.levels[1].price).toBeCloseTo(48, 9);
    expect(r.levels[3].price).toBeCloseTo(44, 9);
  });

  it("rejects a long stop at or above the entry", () => {
    expect(run({ entry: 50, stop: 51 })).toEqual({ ok: false, error: MESSAGES.longStop });
    expect(run({ entry: 50, stop: 50 })).toEqual({ ok: false, error: MESSAGES.longStop });
    expect(MESSAGES.longStop).toContain("stop must be below the entry");
  });

  it("rejects a short stop at or below the entry", () => {
    expect(run({ direction: "short", entry: 50, stop: 49 })).toEqual({
      ok: false,
      error: MESSAGES.shortStop,
    });
  });

  it("asks for the required fields when one is missing or not above 0", () => {
    for (const field of ["account", "riskPct", "entry", "stop"] as const) {
      expect(run({ [field]: null })).toEqual({ ok: false, error: MESSAGES.missing });
      expect(run({ [field]: 0 })).toEqual({ ok: false, error: MESSAGES.missing });
      expect(run({ [field]: -5 })).toEqual({ ok: false, error: MESSAGES.missing });
    }
  });

  it("warns, but still answers, when the stop is too wide for even 1 share", () => {
    const r = ok({ account: 1000, riskPct: 1, entry: 100, stop: 80, target: null });
    expect(r.shares).toBe(0);
    expect(r.actualRisk).toBe(0);
    expect(r.warnings).toEqual([MESSAGES.tooWide]);
  });

  it("does not lose a share to floating point", () => {
    const r = ok({ account: 10000, riskPct: 1, entry: 10.3, stop: 10.2, target: null });
    expect(r.shares).toBe(1000);
  });

  it("warns when the position is bigger than the account", () => {
    const r = ok({ account: 10000, riskPct: 1, entry: 10.3, stop: 10.2, target: null });
    expect(r.positionValue).toBeCloseTo(10300, 6);
    expect(r.warnings).toEqual([MESSAGES.margin]);
  });

  it("flags a target on the wrong side of the entry", () => {
    expect(ok({ target: 49 }).target).toEqual({ kind: "wrong-side" });
    expect(ok({ target: 50.4 }).target).toEqual({ kind: "wrong-side" });
    expect(ok({ direction: "short", entry: 50, stop: 52, target: 51 }).target).toEqual({
      kind: "wrong-side",
    });
  });

  it("treats an empty target as no target", () => {
    expect(ok({ target: null }).target).toEqual({ kind: "none" });
  });
});
