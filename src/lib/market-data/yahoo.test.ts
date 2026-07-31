import { describe, it, expect } from "vitest";
import { guessYahooSymbol } from "./yahoo";

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
