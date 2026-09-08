import { describe, expect, it } from "vitest";
import { buildEquityCurve, type EquityEvent } from "@/lib/equity/build";
import { buildDrawdownReport, MIN_EPISODES_TO_COMPARE } from "./episodes";

// The property that carries this feature: an OPEN drawdown must never be
// averaged in with completed ones. Its recovery has not happened, so counting
// it would bias every recovery figure toward whatever today happens to be --
// and would report a climb as finished when the trader is still in it.

const trade = (at: string, pl: number, r: number | null = null): EquityEvent => ({ at, pl, r });
const cash = (at: string, amount: number): EquityEvent => ({ at, cash: amount });

function report(events: EquityEvent[]) {
  return buildDrawdownReport(buildEquityCurve(events).points);
}

/** A peak, a fall, and a full recovery. */
function episode(day: number, depth: number) {
  const d = (n: number) => `2026-01-${String(day + n).padStart(2, "0")}T00:00:00Z`;
  return [trade(d(0), 100), trade(d(1), depth), trade(d(2), -depth)];
}

describe("buildDrawdownReport — episode boundaries", () => {
  it("opens on the first fall below the peak and closes on regaining it", () => {
    const r = report([
      trade("2026-01-01T00:00:00Z", 1000),
      trade("2026-01-02T00:00:00Z", -400),
      trade("2026-01-03T00:00:00Z", 400),
    ]);

    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].startDate).toBe("2026-01-02");
    expect(r.completed[0].recoveredDate).toBe("2026-01-03");
    expect(r.completed[0].depth).toBeCloseTo(-400);
    expect(r.current).toBeNull();
  });

  it("tracks the trough separately from the recovery", () => {
    // How far down and how long back are different questions.
    const r = report([
      trade("2026-01-01T00:00:00Z", 1000),
      trade("2026-01-02T00:00:00Z", -300),
      trade("2026-01-03T00:00:00Z", -400), // trough
      trade("2026-01-04T00:00:00Z", 100),
      trade("2026-01-10T00:00:00Z", 600), // back to the peak
    ]);
    const e = r.completed[0];

    expect(e.troughDate).toBe("2026-01-03");
    expect(e.depth).toBeCloseTo(-700);
    expect(e.recoveredDate).toBe("2026-01-10");
    // Two trades from the trough back to the peak.
    expect(e.tradesToRecover).toBe(2);
  });

  it("treats a partial bounce as the same episode, not a new one", () => {
    const r = report([
      trade("2026-01-01T00:00:00Z", 1000),
      trade("2026-01-02T00:00:00Z", -500),
      trade("2026-01-03T00:00:00Z", 200), // still below the peak
      trade("2026-01-04T00:00:00Z", -300),
      trade("2026-01-05T00:00:00Z", 600),
    ]);
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].depth).toBeCloseTo(-600);
  });

  it("counts separate falls as separate episodes", () => {
    const r = report([...episode(1, -200), ...episode(5, -300)]);
    expect(r.completed).toHaveLength(2);
  });

  it("finds no episode in a curve that only rises", () => {
    const r = report([trade("2026-01-01T00:00:00Z", 100), trade("2026-01-02T00:00:00Z", 200)]);
    expect(r.episodes).toHaveLength(0);
    expect(r.deepest).toBeNull();
  });
});

describe("buildDrawdownReport — the open episode", () => {
  it("reports an unrecovered fall as current, not completed", () => {
    const r = report([
      trade("2026-01-01T00:00:00Z", 1000),
      trade("2026-01-02T00:00:00Z", -400),
    ]);

    expect(r.completed).toHaveLength(0);
    expect(r.current).not.toBeNull();
    expect(r.current!.recovered).toBe(false);
    expect(r.current!.recoveredDate).toBeNull();
  });

  it("leaves trades-to-recover null while it is still running", () => {
    // Zero would read as "it took no trades", which is a claim that the climb
    // finished. It has not.
    const r = report([trade("2026-01-01T00:00:00Z", 1000), trade("2026-01-02T00:00:00Z", -400)]);
    expect(r.current!.tradesToRecover).toBeNull();
  });

  it("excludes the open episode from every median", () => {
    // Three quick recoveries, then a deep one still running. The medians must
    // describe what finished, not what is still happening.
    const r = report([
      ...episode(1, -100),
      ...episode(5, -100),
      ...episode(9, -100),
      trade("2026-01-20T00:00:00Z", -5000),
    ]);

    expect(r.completed).toHaveLength(3);
    expect(r.medianDepth).toBeCloseTo(-100);
    expect(r.current!.depth).toBeCloseTo(-5000);
  });

  it("still counts the open episode as the deepest overall", () => {
    // It is excluded from averages but not from "how bad has it been" -- the
    // trader is in it right now.
    const r = report([...episode(1, -100), trade("2026-01-20T00:00:00Z", -5000)]);
    expect(r.deepest).toBe(r.current);
  });
});

describe("buildDrawdownReport — flagging an unusual one", () => {
  it("says the current drawdown is the deepest when it is", () => {
    const r = report([...episode(1, -100), ...episode(5, -200), trade("2026-01-20T00:00:00Z", -900)]);
    expect(r.currentIsDeepest).toBe(true);
  });

  it("does not say so when a past one was worse", () => {
    const r = report([...episode(1, -900), ...episode(5, -200), trade("2026-01-20T00:00:00Z", -100)]);
    expect(r.currentIsDeepest).toBe(false);
  });

  it("makes no comparison at all with too few completed episodes", () => {
    // "Your deepest ever" out of two is true and says nothing.
    const r = report([...episode(1, -100), trade("2026-01-20T00:00:00Z", -900)]);
    expect(r.comparable).toBe(false);
  });

  it("becomes comparable once enough episodes have completed", () => {
    const events = Array.from({ length: MIN_EPISODES_TO_COMPARE }, (_, i) =>
      episode(1 + i * 3, -100),
    ).flat();
    expect(report(events).comparable).toBe(true);
  });
});

describe("buildDrawdownReport — cash movements", () => {
  it("does not let a withdrawal open an episode", () => {
    // Inherited from the equity curve: drawdown lives on the trading line.
    const r = report([
      cash("2026-01-01T00:00:00Z", 10000),
      trade("2026-01-02T00:00:00Z", 500),
      cash("2026-01-03T00:00:00Z", -8000),
    ]);
    expect(r.episodes).toHaveLength(0);
  });

  it("does not let a deposit close one", () => {
    const r = report([
      trade("2026-01-01T00:00:00Z", 1000),
      trade("2026-01-02T00:00:00Z", -400),
      cash("2026-01-03T00:00:00Z", 50000),
    ]);
    expect(r.current).not.toBeNull();
    expect(r.current!.recovered).toBe(false);
  });
});

describe("buildDrawdownReport — R accounting", () => {
  it("records R given back and R regained", () => {
    const r = report([
      trade("2026-01-01T00:00:00Z", 1000, 2),
      trade("2026-01-02T00:00:00Z", -400, -1),
      trade("2026-01-03T00:00:00Z", 400, 1),
    ]);
    const e = r.completed[0];

    expect(e.rLost).toBeCloseTo(-1);
    expect(e.rRecovered).toBeCloseTo(1);
  });
});
