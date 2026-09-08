import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market-data/yahoo";
import { calculateExcursion, captureRatio, isDailyResolution, medianBarGapDays } from "./calculate";

// The direction handling and the refusals are what these tests protect. An
// excursion computed with the sign backwards would report every short's best
// moment as its worst, and a same-day "excursion" would be a whole session's
// range presented as something it is not.

function candle(time: string, low: number, high: number): Candle {
  return { time, low, high, open: (low + high) / 2, close: (low + high) / 2 };
}

const BASE = {
  direction: "long",
  entryPrice: 100,
  exitPrice: 104,
  stopLoss: 95,
  entryDay: "2026-08-10",
  exitDay: "2026-08-14",
};

/** The brief's worked example: entry 100, dipped to 97, ran to 108, exit 104. */
const EXAMPLE_CANDLES = [
  candle("2026-08-10", 99, 102),
  candle("2026-08-11", 97, 103),
  candle("2026-08-12", 100, 108),
  candle("2026-08-14", 102, 105),
];

describe("calculateExcursion — the worked example", () => {
  it("reports MAE -3% and MFE +8% for a long", () => {
    const result = calculateExcursion({ ...BASE, candles: EXAMPLE_CANDLES });

    expect(result.status).toBe("ok");
    expect(result.maePrice).toBe(97);
    expect(result.mfePrice).toBe(108);
    expect(result.maePercent).toBeCloseTo(-3);
    expect(result.mfePercent).toBeCloseTo(8);
  });

  it("expresses the same excursions in R against the recorded stop", () => {
    // Risk per unit = |100 - 95| = 5. MAE -3 -> -0.6R, MFE +8 -> +1.6R.
    const result = calculateExcursion({ ...BASE, candles: EXAMPLE_CANDLES });
    expect(result.maeR).toBeCloseTo(-0.6);
    expect(result.mfeR).toBeCloseTo(1.6);
  });

  it("says the figures include partial end days", () => {
    // The entry day's low may predate the entry; the caller must be able to
    // say so rather than presenting an outer bound as exact.
    const result = calculateExcursion({ ...BASE, candles: EXAMPLE_CANDLES });
    expect(result.includesPartialDays).toBe(true);
    expect(result.candlesUsed).toBe(4);
  });
});

describe("calculateExcursion — direction", () => {
  it("inverts favour for a short", () => {
    // Same bars, short from 100: falling to 97 is FAVOURABLE, rising to 108
    // is adverse. A sign error here would swap the two.
    const result = calculateExcursion({
      ...BASE,
      direction: "short",
      exitPrice: 96,
      stopLoss: 105,
      candles: EXAMPLE_CANDLES,
    });

    expect(result.mfePrice).toBe(97);
    expect(result.maePrice).toBe(108);
    expect(result.mfePercent).toBeCloseTo(3);
    expect(result.maePercent).toBeCloseTo(-8);
  });

  it("refuses when no direction was recorded", () => {
    // Without a direction there is no such thing as "in your favour".
    const result = calculateExcursion({ ...BASE, direction: null, candles: EXAMPLE_CANDLES });
    expect(result.status).toBe("no_direction");
    expect(result.maePercent).toBeNull();
  });
});

describe("calculateExcursion — refusals", () => {
  it("refuses a same-day trade outright", () => {
    // One bar cannot separate movement before entry from movement while held.
    const result = calculateExcursion({
      ...BASE,
      entryDay: "2026-08-10",
      exitDay: "2026-08-10",
      candles: [candle("2026-08-10", 90, 120)],
    });
    expect(result.status).toBe("same_day");
    expect(result.mfePercent).toBeNull();
  });

  it("reports no_data when no bar covers the holding period", () => {
    // Outside the history window, delisted, or a mis-guessed symbol.
    const result = calculateExcursion({
      ...BASE,
      candles: [candle("2020-01-02", 50, 60)],
    });
    expect(result.status).toBe("no_data");
  });

  it("reports no_data for an empty candle set", () => {
    expect(calculateExcursion({ ...BASE, candles: [] }).status).toBe("no_data");
  });

  it("refuses when entry or exit price is missing", () => {
    expect(
      calculateExcursion({ ...BASE, entryPrice: null, candles: EXAMPLE_CANDLES }).status,
    ).toBe("no_prices");
    expect(
      calculateExcursion({ ...BASE, exitPrice: null, candles: EXAMPLE_CANDLES }).status,
    ).toBe("no_prices");
  });

  it("refuses a zero entry price rather than dividing by it", () => {
    expect(
      calculateExcursion({ ...BASE, entryPrice: 0, candles: EXAMPLE_CANDLES }).status,
    ).toBe("no_prices");
  });
});

describe("calculateExcursion — R conversion", () => {
  it("leaves R null when no stop was recorded", () => {
    // R without a stop would be a made-up denominator.
    const result = calculateExcursion({ ...BASE, stopLoss: null, candles: EXAMPLE_CANDLES });
    expect(result.status).toBe("ok");
    expect(result.maePercent).toBeCloseTo(-3);
    expect(result.maeR).toBeNull();
    expect(result.mfeR).toBeNull();
  });

  it("leaves R null when the stop equals the entry", () => {
    // Zero risk per unit -- dividing by it would produce Infinity.
    const result = calculateExcursion({ ...BASE, stopLoss: 100, candles: EXAMPLE_CANDLES });
    expect(result.maeR).toBeNull();
  });
});

describe("calculateExcursion — window selection", () => {
  it("ignores bars outside the holding period", () => {
    const result = calculateExcursion({
      ...BASE,
      candles: [
        candle("2026-08-05", 50, 60), // before entry
        ...EXAMPLE_CANDLES,
        candle("2026-08-20", 200, 250), // after exit
      ],
    });
    expect(result.candlesUsed).toBe(4);
    expect(result.mfePrice).toBe(108);
    expect(result.maePrice).toBe(97);
  });

  it("reports a positive MAE when the trade never traded against entry", () => {
    // Gapped up and never looked back. "Never went against you" is a real
    // answer, not something to clamp to zero.
    const result = calculateExcursion({
      ...BASE,
      candles: [candle("2026-08-11", 105, 110), candle("2026-08-14", 106, 112)],
    });
    expect(result.maePercent).toBeGreaterThan(0);
  });
});

describe("captureRatio", () => {
  it("reports the share of the favourable move that was kept", () => {
    // Ran 8, kept 4 -> 50%.
    expect(captureRatio(4, 8)).toBeCloseTo(0.5);
  });

  it("is null when the trade never moved in the trader's favour", () => {
    // Nothing was available to capture, so a percentage would be meaningless
    // -- and dividing by a near-zero MFE would produce a wild number.
    expect(captureRatio(-2, 0)).toBeNull();
    expect(captureRatio(-2, -5)).toBeNull();
    expect(captureRatio(4, null)).toBeNull();
  });

  it("can exceed 1 when the exit beat the daily-bar estimate", () => {
    // Possible because MFE rests on daily highs: an intraday spike the bar
    // missed can leave the realised move above the measured one. Reported as
    // it is rather than clamped, so the figure stays traceable.
    expect(captureRatio(9, 8)).toBeCloseTo(1.125);
  });
});

describe("bar resolution guard", () => {
  it("measures the median gap between bars", () => {
    const daily = [candle("2026-08-10", 1, 2), candle("2026-08-11", 1, 2), candle("2026-08-12", 1, 2)];
    expect(medianBarGapDays(daily)).toBe(1);
  });

  it("accepts a daily series with weekend gaps", () => {
    // Friday to Monday is three days; the median must still read as daily.
    const withWeekend = [
      candle("2026-08-10", 1, 2),
      candle("2026-08-11", 1, 2),
      candle("2026-08-14", 1, 2),
      candle("2026-08-17", 1, 2),
      candle("2026-08-18", 1, 2),
    ];
    expect(isDailyResolution(withWeekend)).toBe(true);
  });

  it("rejects a quarterly series", () => {
    // The real trap: range=max returns ~92-day bars, not daily ones. A
    // quarterly high/low spans three months, so an excursion built from it
    // would be enormous and wrong.
    const quarterly = [
      candle("2026-01-01", 50, 200),
      candle("2026-04-01", 50, 200),
      candle("2026-07-01", 50, 200),
    ];
    // Around 90 depending on which months are sampled; what matters is that
    // it is nowhere near daily and is refused.
    expect(medianBarGapDays(quarterly)).toBeGreaterThan(80);
    expect(isDailyResolution(quarterly)).toBe(false);
  });

  it("rejects a weekly series", () => {
    const weekly = [candle("2026-08-03", 1, 2), candle("2026-08-10", 1, 2), candle("2026-08-17", 1, 2)];
    expect(isDailyResolution(weekly)).toBe(false);
  });

  it("cannot judge a series of fewer than two bars", () => {
    expect(medianBarGapDays([candle("2026-08-10", 1, 2)])).toBeNull();
    expect(isDailyResolution([])).toBe(false);
  });
});
