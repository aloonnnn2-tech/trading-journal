import { describe, it, expect, vi, afterEach } from "vitest";
import { guessYahooSymbol, fetchYahooCandles, fetchYahooBars, fetchYahooNews, isSafeYahooSymbol } from "./yahoo";
import { UpstreamUnavailableError } from "@/lib/http/resilient-fetch";

// Shared by the trade chart and the background auto-execution sweep. When
// only the chart had this, a crypto trade auto-executed in the browser
// (where "BTCUSD" resolved to "BTC-USD") but never in the background, where
// the raw ticker returned no price data at all.
describe("guessYahooSymbol", () => {
  it("passes equities through, uppercased", () => {
    expect(guessYahooSymbol("aapl", "Stock")).toBe("AAPL");
    expect(guessYahooSymbol(" MSFT ", null)).toBe("MSFT");
  });

  it("turns a crypto ticker into Yahoo's dashed pair form", () => {
    expect(guessYahooSymbol("BTCUSD", "Crypto")).toBe("BTC-USD");
    expect(guessYahooSymbol("ETHUSDT", "crypto")).toBe("ETH-USD");
    expect(guessYahooSymbol("BTC-USD", "Crypto")).toBe("BTC-USD");
  });

  it("keeps a bare crypto ticker usable", () => {
    expect(guessYahooSymbol("SOL", "Crypto")).toBe("SOL-USD");
  });

  it("suffixes forex pairs", () => {
    expect(guessYahooSymbol("EURUSD", "Forex")).toBe("EURUSD=X");
    expect(guessYahooSymbol("GBPJPY", "fx")).toBe("GBPJPY=X");
  });

  it("strips separators the user may have typed", () => {
    expect(guessYahooSymbol("BRK/B", "Stock")).toBe("BRKB");
  });

  it("returns empty for an empty ticker, so callers can skip it", () => {
    expect(guessYahooSymbol("", "Stock")).toBe("");
    expect(guessYahooSymbol("   ", null)).toBe("");
  });
});

const okBody = {
  chart: {
    result: [
      {
        timestamp: [1_700_000_000],
        indicators: { quote: [{ open: [1], high: [2], low: [0.5], close: [1.5] }] },
        meta: { regularMarketPrice: 1.5, regularMarketDayHigh: 2, regularMarketDayLow: 0.5 },
      },
    ],
  },
};

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status });
}

// A transient failure (network blip, momentary 5xx) shouldn't sink a whole
// chart load or a cron sweep tick when a couple of retries would recover it.
describe("fetchYahooCandles retry behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries a 5xx and succeeds once a later attempt returns ok", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502))
      .mockResolvedValueOnce(jsonResponse(200, okBody));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchYahooCandles("AAPL");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.candles).toHaveLength(1);
  });

  it("does not retry a 4xx -- it's not a transient failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(404));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchYahooCandles("NOTATICKER");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("gives up after exhausting retries on repeated 5xx -- as an outage, not 'no such symbol'", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchYahooCandles("AAPL");
    const outcome = expect(promise).rejects.toBeInstanceOf(UpstreamUnavailableError);
    await vi.runAllTimersAsync();
    await outcome;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

// Regression: a daily bar's date has to be read in the exchange's own local
// time, not UTC. A forex pair's bar is stamped at its session start, which
// for Europe/London is 23:00 UTC the *previous* evening -- slicing that in
// UTC dated every forex candle a full day earlier than the day it actually
// represents. Verified against real EURUSD=X data before fixing; every
// timestamp below is one actually returned by Yahoo for that symbol.
describe("fetchYahooCandles dates each bar in the exchange's own timezone", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function bodyFor(timestamps: number[], exchangeTimezoneName: string) {
    return {
      chart: {
        result: [
          {
            timestamp: timestamps,
            indicators: {
              quote: [
                {
                  open: timestamps.map(() => 1),
                  high: timestamps.map(() => 1),
                  low: timestamps.map(() => 1),
                  close: timestamps.map(() => 1),
                },
              ],
            },
            meta: { exchangeTimezoneName },
          },
        ],
      },
    };
  }

  it("EURUSD=X: a bar stamped 23:00 UTC the evening before is the *next* calendar day in London", async () => {
    // Real timestamps from a live EURUSD=X 5d/1d pull.
    const timestamps = [1786057200, 1786316400, 1786402800, 1786489200, 1786575600];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, bodyFor(timestamps, "Europe/London"))),
    );

    const result = await fetchYahooCandles("EURUSD=X");

    expect(result?.candles.map((c) => c.time)).toEqual([
      "2026-08-07",
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
    ]);
  });

  it("a US equity's market-open timestamp lands on the same date either way", async () => {
    // Real timestamps from a live AAPL 5d/1d pull -- included so a future
    // change can't fix forex by accidentally shifting stocks off by a day.
    const timestamps = [1786109400, 1786368600, 1786455000, 1786541400, 1786627800];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, bodyFor(timestamps, "America/New_York"))),
    );

    const result = await fetchYahooCandles("AAPL");

    expect(result?.candles.map((c) => c.time)).toEqual([
      "2026-08-07",
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
    ]);
  });

  it("falls back to UTC if Yahoo ever omits the exchange timezone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, bodyFor([1786060800], ""))));
    const result = await fetchYahooCandles("BTC-USD");
    expect(result?.candles[0].time).toBe("2026-08-07");
  });

  it("falls back to UTC rather than throwing if the timezone name is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, bodyFor([1786060800], "Not/A_Real_Zone"))),
    );
    const result = await fetchYahooCandles("AAPL");
    expect(result?.candles[0].time).toBe("2026-08-07");
  });
});

// The trade chart's holding-period bars (Phase 4C): a date range at one bar
// size, with unix times kept as they are -- intraday bars have no calendar
// date of their own.
describe("fetchYahooBars", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const body = {
    chart: {
      result: [
        {
          timestamp: [1_788_356_400, 1_788_356_700, 1_788_357_000],
          indicators: { quote: [{ open: [350, null, 352], high: [351, 353, 354], low: [349, 350, 351], close: [350.5, 352, 353] }] },
          meta: { gmtoffset: -14_400, exchangeTimezoneName: "America/New_York" },
        },
      ],
    },
  };

  it("asks for the range and bar size, and keeps unix times and the exchange offset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchYahooBars("TSLA", { interval: "5m", period1: 1_788_000_000, period2: 1_788_500_000 }, 1_789_000_000);

    expect(String(fetchMock.mock.calls[0][0])).toContain("/TSLA?period1=1788000000&period2=1788500000&interval=5m&includePrePost=true");
    // The bar with a missing open is skipped rather than drawn at zero.
    expect(result?.bars.map((b) => b.time)).toEqual([1_788_356_400, 1_788_357_000]);
    // The zone, not gmtoffset: that's the offset today, wrong for a winter bar.
    expect(result?.timeZone).toBe("America/New_York");
  });

  it("caches a range that's entirely in the past for a day, and one reaching today for five minutes", async () => {
    // A fresh Response per call: a body can only be read once.
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);
    const now = 1_789_000_000;

    await fetchYahooBars("TSLA", { interval: "5m", period1: 1_788_000_000, period2: now - 3 * 86_400 }, now);
    await fetchYahooBars("TSLA", { interval: "5m", period1: 1_788_000_000, period2: now }, now);

    expect(fetchMock.mock.calls[0][1].next.revalidate).toBe(86_400);
    expect(fetchMock.mock.calls[1][1].next.revalidate).toBe(300);
  });

  it("asks for regular hours only on daily bars", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);
    await fetchYahooBars("TSLA", { interval: "1d", period1: 1, period2: 2 });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("includePrePost");
  });

  it("asks for regular hours on weekly and monthly bars too, and drops a repeated live period", async () => {
    const monthly = {
      chart: {
        result: [
          {
            // The live month comes back stamped before the last full one.
            timestamp: [1_788_000_000, 1_790_600_000, 1_790_000_000],
            indicators: { quote: [{ open: [1, 2, 3], high: [1, 2, 3], low: [1, 2, 3], close: [1, 2, 3] }] },
            meta: { exchangeTimezoneName: "America/New_York" },
          },
        ],
      },
    };
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, monthly));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchYahooBars("TSLA", { interval: "1mo", period1: 1, period2: 2 });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("includePrePost");
    expect(result?.bars.map((b) => b.time)).toEqual([1_788_000_000, 1_790_600_000]);
  });

  it("is null for an unknown symbol", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404)));
    expect(await fetchYahooBars("NOPE", { interval: "1d", period1: 0, period2: 1 })).toBeNull();
  });
});

describe("isSafeYahooSymbol (security gaps pass, G-14)", () => {
  it("accepts every real symbol shape", () => {
    for (const s of ["AAPL", "BRK.B", "BTC-USD", "EURUSD=X", "^GSPC", "7203.T", "RDS-A"]) expect(isSafeYahooSymbol(s), s).toBe(true);
  });

  it("refuses path tricks, other hosts, encodings and control characters", () => {
    for (const s of ["..", ".", "...", "../x", "AAPL/..", "@evil.com", "a@b", "%00", "%2e%2e", "AA\u0000PL", "AAPL?x=1", "AAPL#", "a b", "", "A".repeat(26)]) {
      expect(isSafeYahooSymbol(s), JSON.stringify(s)).toBe(false);
    }
  });
});

describe("unsafe symbols never reach Yahoo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns no data without making a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const s of ["..", "../v7", "@evil.com", "%00", "127.0.0.1/x"]) {
      expect(await fetchYahooCandles(s), s).toBeNull();
      expect(await fetchYahooBars(s, { interval: "1d", period1: 1, period2: 2 }), s).toBeNull();
      expect(await fetchYahooNews(s), s).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the host fixed for a valid but odd symbol (digits and dots)", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (urls.push(u), new Response("{}", { status: 404 }))));
    await fetchYahooCandles("127.0.0.1");
    expect(new URL(urls[0]).host).toBe("query1.finance.yahoo.com");
    expect(new URL(urls[0]).pathname).toBe("/v8/finance/chart/127.0.0.1");
  });
});
