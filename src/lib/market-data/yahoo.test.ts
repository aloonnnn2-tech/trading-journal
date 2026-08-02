import { describe, it, expect, vi, afterEach } from "vitest";
import { guessYahooSymbol, fetchYahooCandles } from "./yahoo";

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

  it("gives up after exhausting retries on repeated 5xx", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchYahooCandles("AAPL");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toBeNull();
  });
});
