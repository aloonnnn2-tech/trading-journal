import { describe, expect, it } from "vitest";
import { buildExcursionReport, type ExcursionTrade } from "./aggregate";
import type { ExcursionRow } from "./queries";

// What matters here is that an average never quietly covers fewer trades than
// it appears to. Rows that could not be computed are counted and reported, not
// dropped into a smaller denominator without saying so.

function trade(over: Partial<ExcursionTrade> = {}): ExcursionTrade {
  return {
    id: `t-${Math.random()}`,
    dollar_pl: 100,
    entry_price: 100,
    exit_price: 104,
    // |100 - 95| = 5 per unit, matching the mae_r/mfe_r in the row factory.
    stop_loss: 95,
    direction: "long",
    strategies: ["Breakout"],
    ...over,
  };
}

function row(tradeId: string, over: Partial<ExcursionRow> = {}): ExcursionRow {
  return {
    trade_id: tradeId,
    symbol: "NVDA",
    status: "ok",
    mae_price: 97,
    mfe_price: 108,
    mae_percent: -3,
    mfe_percent: 8,
    mae_r: -0.6,
    mfe_r: 1.6,
    candles_used: 4,
    includes_partial_days: true,
    computed_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

/** n matched trade/row pairs. */
function pairs(n: number, t: Partial<ExcursionTrade> = {}, r: Partial<ExcursionRow> = {}) {
  const trades = Array.from({ length: n }, () => trade(t));
  return { trades, rows: trades.map((x) => row(x.id, r)) };
}

describe("buildExcursionReport", () => {
  it("averages MAE and MFE over usable rows", () => {
    const { trades, rows } = pairs(3);
    const report = buildExcursionReport(trades, rows);

    expect(report.overall.trades).toBe(3);
    expect(report.overall.avgMaePercent).toBeCloseTo(-3);
    expect(report.overall.avgMfePercent).toBeCloseTo(8);
    expect(report.overall.avgMaeR).toBeCloseTo(-0.6);
  });

  it("counts trades with no excursion row as not computed, not as zero", () => {
    // An unmeasured trade must never be averaged in as if it had no excursion.
    const { trades, rows } = pairs(2);
    const report = buildExcursionReport([...trades, trade()], rows);

    expect(report.notComputed).toBe(1);
    expect(report.overall.trades).toBe(2);
  });

  it("counts and explains rows that were answered but carry no figures", () => {
    const { trades, rows } = pairs(2);
    const refused = trade();
    const report = buildExcursionReport(
      [...trades, refused],
      [...rows, row(refused.id, { status: "same_day", mae_percent: null, mfe_percent: null })],
    );

    expect(report.unavailable).toEqual({ same_day: 1 });
    expect(report.overall.trades).toBe(2);
    expect(report.notComputed).toBe(0);
  });

  it("reports how many trades the R averages rest on", () => {
    // A trade with no stop has no R; the % average covers it but the R one
    // does not, and the difference has to be visible.
    const withR = pairs(2);
    const noStop = trade();
    const report = buildExcursionReport(
      [...withR.trades, noStop],
      [...withR.rows, row(noStop.id, { mae_r: null, mfe_r: null })],
    );

    expect(report.overall.trades).toBe(3);
    expect(report.overall.withR).toBe(2);
  });

  it("splits winners from losers by net P&L", () => {
    const winners = pairs(2, { dollar_pl: 100 });
    const losers = pairs(3, { dollar_pl: -50 }, { mae_percent: -6, mfe_percent: 2 });
    const report = buildExcursionReport(
      [...winners.trades, ...losers.trades],
      [...winners.rows, ...losers.rows],
    );

    expect(report.winners.trades).toBe(2);
    expect(report.losers.trades).toBe(3);
    expect(report.losers.avgMaePercent).toBeCloseTo(-6);
  });

  it("excludes break-even trades from both winners and losers", () => {
    const { trades, rows } = pairs(1, { dollar_pl: 0 });
    const report = buildExcursionReport(trades, rows);
    expect(report.winners.trades).toBe(0);
    expect(report.losers.trades).toBe(0);
    expect(report.overall.trades).toBe(1);
  });

  it("discloses that figures rest on partial end-day bars", () => {
    const { trades, rows } = pairs(1);
    expect(buildExcursionReport(trades, rows).includesPartialDays).toBe(true);
  });
});

describe("buildExcursionReport — capture ratio", () => {
  it("uses the median share of the favourable move that was kept", () => {
    // Entry 100, exit 104 (kept 4), MFE 108 (available 8) -> 50%.
    const { trades, rows } = pairs(3);
    const report = buildExcursionReport(trades, rows);

    expect(report.overall.medianCapture).toBeCloseTo(0.5);
    expect(report.overall.captureSample).toBe(3);
  });

  it("inverts correctly for a short", () => {
    // Short from 100, covered at 96 (kept 4), MFE 92 (available 8) -> 50%.
    const t = trade({ direction: "short", entry_price: 100, exit_price: 96 });
    const report = buildExcursionReport([t], [row(t.id, { mfe_price: 92 })]);
    expect(report.overall.medianCapture).toBeCloseTo(0.5);
  });

  it("omits trades that never moved in the trader's favour", () => {
    // Nothing was available to capture, so there is no ratio -- not a zero.
    const t = trade({ exit_price: 95 });
    const report = buildExcursionReport([t], [row(t.id, { mfe_price: 100 })]);

    expect(report.overall.medianCapture).toBeNull();
    expect(report.overall.captureSample).toBe(0);
    // The trade still counts toward the MAE/MFE averages.
    expect(report.overall.trades).toBe(1);
  });

  it("uses the median so one outlier does not move the headline", () => {
    // Two trades at 50%, one that exited above the measured MFE (ratio > 1).
    const normal = pairs(2);
    const spike = trade({ exit_price: 118 });
    const report = buildExcursionReport(
      [...normal.trades, spike],
      [...normal.rows, row(spike.id)],
    );

    expect(report.overall.medianCapture).toBeCloseTo(0.5);
  });
});

describe("buildExcursionReport — by strategy", () => {
  it("only reports a strategy once it clears the sample floor", () => {
    const big = pairs(5, { strategies: ["Breakout"] });
    const small = pairs(2, { strategies: ["Reversal"] });
    const report = buildExcursionReport(
      [...big.trades, ...small.trades],
      [...big.rows, ...small.rows],
    );

    expect(report.byStrategy.map((s) => s.strategy)).toEqual(["Breakout"]);
  });

  it("counts a trade under every strategy it carries", () => {
    const { trades, rows } = pairs(5, { strategies: ["Breakout", "Momentum"] });
    const report = buildExcursionReport(trades, rows);

    expect(report.byStrategy.map((s) => s.strategy).sort()).toEqual(["Breakout", "Momentum"]);
    expect(report.byStrategy.every((s) => s.stats.trades === 5)).toBe(true);
  });
});

describe("buildExcursionReport — exit efficiency", () => {
  /** A trade whose realised move captures `share` of an 8-point MFE. */
  function atCapture(share: number) {
    const t = trade({ entry_price: 100, exit_price: 100 + 8 * share });
    return { t, r: row(t.id, { mfe_price: 108 }) };
  }

  it("reports realised R on the same basis as the MFE R", () => {
    // Entry 100, exit 104, stop 95 -> risk 5 per unit -> realised +0.8R,
    // against the row's mfe_r of +1.6R. Their ratio is the capture: 50%.
    const { trades, rows } = pairs(2);
    const report = buildExcursionReport(trades, rows);

    expect(report.overall.avgRealisedR).toBeCloseTo(0.8);
    expect(report.overall.avgMfeR).toBeCloseTo(1.6);
    expect(report.overall.realisedRSample).toBe(2);
    // Consistency is the point: realised / available IS the capture.
    expect(report.overall.avgRealisedR! / report.overall.avgMfeR!).toBeCloseTo(
      report.overall.medianCapture!,
    );
  });

  it("omits realised R when no stop was recorded", () => {
    // Without a stop there is no risk to divide by, and inventing one would
    // fabricate the denominator.
    const t = trade({ stop_loss: null });
    const report = buildExcursionReport([t], [row(t.id, { mae_r: null, mfe_r: null })]);

    expect(report.overall.avgRealisedR).toBeNull();
    expect(report.overall.realisedRSample).toBe(0);
    // The percentage figures still cover it.
    expect(report.overall.trades).toBe(1);
  });

  it("omits realised R when the stop sits at the entry", () => {
    const t = trade({ stop_loss: 100 });
    const report = buildExcursionReport([t], [row(t.id)]);
    expect(report.overall.avgRealisedR).toBeNull();
  });

  it("distributes captures into bands, each trade in exactly one", () => {
    const cases = [0.1, 0.3, 0.6, 0.9];
    const built = cases.map(atCapture);
    const report = buildExcursionReport(
      built.map((b) => b.t),
      built.map((b) => b.r),
    );

    const byLabel = Object.fromEntries(report.overall.captureBands.map((b) => [b.label, b.trades]));
    expect(byLabel["Under 25%"]).toBe(1);
    expect(byLabel["25-50%"]).toBe(1);
    expect(byLabel["50-75%"]).toBe(1);
    expect(byLabel["Over 75%"]).toBe(1);

    // Every trade landed somewhere, and nowhere twice.
    const total = report.overall.captureBands.reduce((n, b) => n + b.trades, 0);
    expect(total).toBe(report.overall.captureSample);
  });

  it("separates 'gave it back' from a small capture", () => {
    // Ran to 108 then closed at 96: a LOSS despite a favourable move. That is
    // a different problem from taking a small piece, and the brief names it
    // separately, so it must not be folded into "under 25%".
    const gaveBack = trade({ entry_price: 100, exit_price: 96 });
    const small = atCapture(0.1);
    const report = buildExcursionReport(
      [gaveBack, small.t],
      [row(gaveBack.id, { mfe_price: 108 }), small.r],
    );

    const byLabel = Object.fromEntries(report.overall.captureBands.map((b) => [b.label, b.trades]));
    expect(byLabel["Gave it back"]).toBe(1);
    expect(byLabel["Under 25%"]).toBe(1);
  });

  it("puts a boundary capture in the higher band, not both", () => {
    // Exactly 50% belongs to "50-75%": the bands are half-open [min, max).
    const exact = atCapture(0.5);
    const report = buildExcursionReport([exact.t], [exact.r]);
    const byLabel = Object.fromEntries(report.overall.captureBands.map((b) => [b.label, b.trades]));

    expect(byLabel["25-50%"]).toBe(0);
    expect(byLabel["50-75%"]).toBe(1);
  });

  it("counts an above-100% capture in the top band rather than dropping it", () => {
    // Possible because MFE rests on daily highs -- an intraday spike the bar
    // missed leaves the realised move above the measured one.
    const over = atCapture(1.4);
    const report = buildExcursionReport([over.t], [over.r]);
    const byLabel = Object.fromEntries(report.overall.captureBands.map((b) => [b.label, b.trades]));

    expect(byLabel["Over 75%"]).toBe(1);
    expect(report.overall.captureSample).toBe(1);
  });
});
