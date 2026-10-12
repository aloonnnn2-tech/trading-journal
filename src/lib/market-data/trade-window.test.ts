import { describe, expect, it } from "vitest";
import {
  barIndexAt,
  chooseBars,
  DEFAULT_TIMEFRAME,
  timeframeAvailability,
  TIMEFRAME_LABELS,
  TIMEFRAMES,
  fitRange,
  formatBarTime,
  formatQuote,
  locate,
  priceMismatch,
  tradeMarkers,
  visibleRange,
  zoneOffset,
  type Bar,
} from "./trade-window";

// The trade chart's view of a trade (Phase 4C). The chart used to fit two
// years of daily bars, squashing entry, stop and target onto one line; these
// pin the window it opens on, the markers, and the check that says when the
// trade's prices don't belong on the market's bars at all.

const DAY = 86_400;
const NOW = Date.UTC(2026, 8, 28, 12) / 1000; // 28 Sep 2026
const at = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;

function bars(start: number, step: number, n: number, price = 100): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ time: start + i * step, open: price, high: price + 2, low: price - 2, close: price }));
}

describe("chooseBars", () => {
  it("opens on daily bars around the holding period", () => {
    // The spec's example: TSLA, 2 Sep 2026, held 17 minutes.
    const req = chooseBars(at(2026, 9, 2, 13, 53), at(2026, 9, 2, 14, 10), NOW);
    expect(req.interval).toBe("1d");
    expect(req.period1).toBe(at(2026, 9, 2, 13, 53) - 150 * DAY);
    expect(req.period2).toBe(NOW);
  });

  it("fetches the size asked for, with that size's context either side", () => {
    const req = chooseBars(at(2026, 9, 2, 13, 53), at(2026, 9, 2, 14, 10), NOW, "5m");
    expect(req.interval).toBe("5m");
    expect(req.period1).toBe(at(2026, 8, 29, 13, 53));
    expect(req.period2).toBe(at(2026, 9, 4, 14, 10));
    expect(chooseBars(at(2026, 9, 1), at(2026, 9, 8), NOW, "60m").interval).toBe("60m");
    expect(chooseBars(at(2026, 9, 1), at(2026, 9, 8), NOW, "1wk").period1).toBe(at(2026, 9, 1) - 2 * 365 * DAY);
  });

  it("never asks for intraday bars older than Yahoo keeps", () => {
    // Entered 58 days ago: 5m is allowed, but the context before entry would
    // reach past the 60-day limit.
    const req = chooseBars(NOW - 58 * DAY, NOW - 58 * DAY + 3600, NOW, "5m");
    expect(req.period1).toBeGreaterThanOrEqual(NOW - 59 * DAY);
  });

  it("asks for at most a week of 1-minute bars, from just before the entry", () => {
    const entry = NOW - 20 * DAY;
    const req = chooseBars(entry, NOW - 2 * DAY, NOW, "1m");
    expect(req.period1).toBe(entry - DAY);
    expect(req.period2 - req.period1).toBe(7 * DAY);
  });

  it("stays inside the ten years the bars route allows", () => {
    const req = chooseBars(at(2010, 1, 1), at(2020, 1, 1), NOW, "1mo");
    expect(req.period2 - req.period1).toBeLessThanOrEqual(10 * 365 * DAY);
  });

  it("runs an open trade's hold, and the range, up to now", () => {
    const req = chooseBars(NOW - 3 * DAY, null, NOW, "60m");
    expect(req.period2).toBe(NOW);
  });
});

describe("timeframeAvailability", () => {
  it("offers every size for a recent trade", () => {
    for (const interval of TIMEFRAMES) expect(timeframeAvailability(interval, NOW - 2 * DAY, NOW).ok).toBe(true);
  });

  it("says why an older trade can't be shown in short bars", () => {
    const entry = NOW - 90 * DAY;
    const fiveMin = timeframeAvailability("5m", entry, NOW);
    expect(fiveMin).toEqual({ ok: false, reason: "Yahoo keeps 5-minute bars for 60 days; this trade is older." });
    expect(timeframeAvailability("1m", NOW - 40 * DAY, NOW).ok).toBe(false);
    expect(timeframeAvailability("60m", entry, NOW).ok).toBe(true);
    expect(timeframeAvailability("60m", NOW - 3 * 365 * DAY, NOW).ok).toBe(false);
    expect(timeframeAvailability("1d", NOW - 20 * 365 * DAY, NOW).ok).toBe(true);
    expect(timeframeAvailability("1mo", NOW - 20 * 365 * DAY, NOW).ok).toBe(true);
  });

  it("opens on daily, and labels every size", () => {
    expect(DEFAULT_TIMEFRAME).toBe("1d");
    expect(TIMEFRAMES.map((t) => TIMEFRAME_LABELS[t].short)).toEqual(["1m", "5m", "15m", "1h", "1D", "1W", "1M"]);
  });
});

describe("barIndexAt", () => {
  const b = bars(1000, 300, 5); // 1000, 1300, 1600, 1900, 2200

  it("finds the bar a moment falls in", () => {
    expect(barIndexAt(b, 1000)).toBe(0);
    expect(barIndexAt(b, 1299)).toBe(0);
    expect(barIndexAt(b, 1300)).toBe(1);
    expect(barIndexAt(b, 9999)).toBe(4);
  });

  it("is -1 before the first bar", () => {
    expect(barIndexAt(b, 999)).toBe(-1);
    expect(barIndexAt([], 1000)).toBe(-1);
  });
});

describe("visibleRange", () => {
  const b = bars(0, 60, 100);

  it("pads the holding period on both sides", () => {
    expect(visibleRange(b, 40, 45, 10)).toEqual({ from: 30, to: 55 });
  });

  it("clamps to the bars there are", () => {
    expect(visibleRange(b, 3, 97, 10)).toEqual({ from: 0, to: 99 });
  });

  it("runs an open trade to the last bar", () => {
    expect(visibleRange(b, 90, -1, 10)).toEqual({ from: 80, to: 99 });
  });

  it("is null when the entry isn't in the bars", () => {
    expect(visibleRange(b, -1, 5)).toBeNull();
  });
});

describe("tradeMarkers", () => {
  const b = bars(0, 60, 10);

  it("puts ▲ on a long's entry and ▼ on its exit", () => {
    expect(tradeMarkers(b, 2, 6, "long")).toEqual([
      { time: 120, position: "belowBar", shape: "arrowUp", text: "Entry" },
      { time: 360, position: "aboveBar", shape: "arrowDown", text: "Exit" },
    ]);
  });

  it("flips them for a short", () => {
    expect(tradeMarkers(b, 2, 6, "short")).toEqual([
      { time: 120, position: "aboveBar", shape: "arrowDown", text: "Entry" },
      { time: 360, position: "belowBar", shape: "arrowUp", text: "Exit" },
    ]);
  });

  it("marks only the entry of an open trade", () => {
    expect(tradeMarkers(b, 2, -1, "long")).toHaveLength(1);
  });
});

describe("priceMismatch", () => {
  const b = bars(0, 60, 10, 355); // every bar 353-357
  const on = (index: number) => ({ index, inside: true });
  const none = { index: -1, inside: false };

  it("is null when the entry is on its bar", () => {
    expect(priceMismatch(b, { entryPrice: 356, entry: on(3), exitPrice: null, exit: none })).toBeNull();
  });

  it("allows a sliver of slack for fills at the bar's edge", () => {
    expect(priceMismatch(b, { entryPrice: 357.5, entry: on(3), exitPrice: null, exit: none })).toBeNull();
  });

  it("flags an entry far off its bar -- the demo's TSLA at 234 against a 350 market", () => {
    expect(priceMismatch(b, { entryPrice: 234.54, entry: on(3), exitPrice: 236.6, exit: on(4) })).toEqual({
      label: "Entry",
      price: 234.54,
      low: 353,
      high: 357,
      barTime: 180,
    });
  });

  it("checks the exit when there's no entry price", () => {
    expect(priceMismatch(b, { entryPrice: null, entry: none, exitPrice: 500, exit: on(4) })?.label).toBe("Exit");
  });

  it("can't judge a moment that fell in a gap between bars", () => {
    expect(priceMismatch(b, { entryPrice: 1, entry: { index: 3, inside: false }, exitPrice: null, exit: none })).toBeNull();
  });

  it("can't judge without a bar", () => {
    expect(priceMismatch(b, { entryPrice: 1, entry: none, exitPrice: null, exit: none })).toBeNull();
  });
});

describe("fitRange", () => {
  it("widens the bars' range to take in the trade's levels", () => {
    expect(fitRange({ min: 350, max: 360 }, [358, 346, 371, null], false)).toEqual({ min: 346, max: 371 });
  });

  it("fits the trade's levels alone when they don't match the bars", () => {
    expect(fitRange({ min: 349.92, max: 360.62 }, [234.54, 237.52, 227.09, null, 236.6], true)).toEqual({
      min: 227.09,
      max: 237.52,
    });
  });

  it("keeps the bars' range when the trade has no levels", () => {
    expect(fitRange({ min: 1, max: 2 }, [null, null], false)).toEqual({ min: 1, max: 2 });
  });

  it("gives a single level some room", () => {
    expect(fitRange(null, [100], true)).toEqual({ min: 99, max: 101 });
  });
});

const NY = "America/New_York";

describe("zoneOffset", () => {
  it("follows daylight saving", () => {
    expect(zoneOffset(NY, at(2026, 9, 2, 14))).toBe(-4 * 3600);
    expect(zoneOffset(NY, at(2025, 11, 6, 14))).toBe(-5 * 3600);
    expect(zoneOffset("UTC", at(2026, 9, 2, 14))).toBe(0);
  });

  it("reads an unknown zone as UTC rather than failing the chart", () => {
    expect(zoneOffset("Not/AZone", at(2026, 9, 2, 14))).toBe(0);
  });
});

describe("locate", () => {
  // Hourly bars for two New York sessions in November (UTC-5): 09:30-15:30.
  const session = (y: number, m: number, d: number) => bars(at(y, m, d, 14, 30), 3600, 7);
  const hourly = [...session(2025, 11, 5), ...session(2025, 11, 6)];

  it("finds the bar a moment is inside", () => {
    expect(locate(hourly, at(2025, 11, 6, 15, 10), "60m", NY)).toEqual({ index: 7, inside: true });
  });

  it("puts a pre-open moment on the next bar, not the previous afternoon's", () => {
    // 09:20 New York, before the 09:30 bar: the demo SPY trade.
    expect(locate(hourly, at(2025, 11, 6, 14, 20), "60m", NY)).toEqual({ index: 7, inside: false });
  });

  it("puts an overnight moment on the next morning's bar", () => {
    expect(locate(hourly, at(2025, 11, 6, 2), "60m", NY)).toEqual({ index: 7, inside: false });
  });

  it("is -1 after the last bar", () => {
    expect(locate(hourly, at(2025, 11, 7, 20), "60m", NY)).toEqual({ index: -1, inside: false });
  });

  it("matches a daily bar by calendar date, even before that day's open", () => {
    const daily = [at(2025, 11, 5, 14, 30), at(2025, 11, 6, 14, 30), at(2025, 11, 7, 14, 30)].map((time) => ({
      time,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
    }));
    expect(locate(daily, at(2025, 11, 6, 14, 20), "1d", NY)).toEqual({ index: 1, inside: true });
    expect(locate(daily, at(2025, 11, 6, 20), "1d", NY)).toEqual({ index: 1, inside: true });
    // Saturday: no bar that day, so the next one, and nothing to judge.
    expect(locate(daily, at(2025, 11, 8, 15), "1d", NY)).toEqual({ index: -1, inside: false });
  });

  it("puts a moment on the weekly bar whose seven days hold it", () => {
    // Yahoo stamps a weekly bar at its Monday: 3, 10 and 17 Nov 2025.
    const weekly = [at(2025, 11, 3, 5), at(2025, 11, 10, 5), at(2025, 11, 17, 5)].map((time) => ({
      time,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
    }));
    expect(locate(weekly, at(2025, 11, 13, 15), "1wk", NY)).toEqual({ index: 1, inside: true });
    expect(locate(weekly, at(2025, 11, 16, 15), "1wk", NY)).toEqual({ index: 1, inside: true });
    expect(locate(weekly, at(2025, 11, 17, 15), "1wk", NY)).toEqual({ index: 2, inside: true });
  });

  it("puts a moment on its calendar month's bar", () => {
    const monthly = [at(2025, 9, 1, 4), at(2025, 10, 1, 4), at(2025, 11, 1, 4)].map((time) => ({
      time,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
    }));
    expect(locate(monthly, at(2025, 10, 31, 20), "1mo", NY)).toEqual({ index: 1, inside: true });
    expect(locate(monthly, at(2025, 11, 2, 15), "1mo", NY)).toEqual({ index: 2, inside: true });
  });
});

describe("formatBarTime", () => {
  it("reads the market's own clock, whatever the viewer's timezone", () => {
    // 13:50 UTC is 09:50 in New York during daylight time (UTC-4).
    expect(formatBarTime(at(2026, 9, 2, 13, 50), NY, "5m")).toBe("2 Sep 2026, 09:50");
    expect(formatBarTime(at(2026, 9, 2, 13, 30), NY, "1d")).toBe("2 Sep 2026");
    expect(formatBarTime(at(2026, 8, 31, 4), NY, "1wk")).toBe("week of 31 Aug 2026");
    expect(formatBarTime(at(2026, 9, 1, 4), NY, "1mo")).toBe("Sep 2026");
  });

  it("uses the offset of the bar's own date, not today's", () => {
    // 14:30 UTC in November is 09:30 in New York (UTC-5), not 10:30.
    expect(formatBarTime(at(2025, 11, 6, 14, 30), NY, "60m")).toBe("6 Nov 2025, 09:30");
  });
});

describe("formatQuote", () => {
  it("drops Yahoo's float noise", () => {
    expect(formatQuote(351.63000488)).toBe("351.63");
    expect(formatQuote(61500.5)).toBe("61,500.50");
    expect(formatQuote(0.0000123456789)).toBe("0.0000123457");
  });
});
