import { describe, expect, it } from "vitest";
import { detectOrderType, orderSummary } from "./order-type";

// The order type as each platform writes it, in the shape the OCR reads it
// (lines from real screenshots, 2026-10-11; the images themselves are other
// sites' and stay out of the repo). The guarantee: a type is filled in only
// when the screen states it for the order, and never when the screen holds
// several different orders, a menu, or a row of tabs.

const type = (text: string) => detectOrderType(text)?.value ?? null;

describe("detectOrderType: stated types", () => {
  it("IBKR TWS order row: STP LMT is a stop-limit, never 'limit' with STP as the symbol", () => {
    const tws = [
      "Action Quantity Type Stop Price Lmt Price",
      "YHOO SMART (A. Stock (NASD) 5 27.04 27.06 42 26.96 -0.18",
      "· daY SELL 1,000 STP LMT 28.03 28.03",
      "IBM ISLAND Stock (NYSE) 128.26 128.29 LMT 127.87",
      "IBM SMART (A. Stock (NYSE) 17 128.26 128.29 MKT 127.87 +0.35",
      "DELL SMART (IS... JUN 20 08 20... STP LMT C0.79",
    ].join("\n");
    expect(type(tws)).toBe("stop_limit");
    expect(orderSummary("· daY SELL 1,000 STP LMT 28.03")).toBeNull();
    expect(type("· dAY SELL 1,000  STP 28.03 SMA.")).toBe("stop");
    expect(type("O dAY BUY 100 TRAIL 1.00")).toBe("trailing_stop");
    expect(type("·DAYBUY 10,000 MKT MARKET SMART")).toBe("market");
    expect(type("· DAY SELL 100 LMT 151.68 SMART\nDAY BUY 100 LMT 151.71 SMART")).toBe("limit");
  });

  it("the label, on the same line or the one below", () => {
    expect(type("Side Buy Sel!\nOrder Type STOP\nStop Price $76.7600")).toBe("stop"); // Webull app
    expect(type("Ordee type Limit α $200.00")).toBe("limit"); // Fidelity, OCR's "Ordee"
    expect(type("Price type ①\nMarket V\nDuration O")).toBe("market"); // E*TRADE
    expect(type("Price type O Stop value S①\nTrailing stop $ 2.00")).toBe("trailing_stop");
    expect(type("PriceType\nMarket Bid Ask")).toBe("market"); // Power E*TRADE
  });

  it("the order button: TradingView and its brokers", () => {
    expect(type("Buy\n2 NQ1! @ 25, 186.50 STP")).toBe("stop");
    expect(type("1 NQZ5 @ 24,755.00 STP / 24,755.25 LMT")).toBe("stop_limit");
    expect(type("BUY 1 000 EUR/USD @ 1.22641 LMT")).toBe("limit");
    expect(type("1,000 EUR/USD @ 1.15299 LMT")).toBe("limit");
    expect(orderSummary("10AAPL@278.00LMT")).toMatchObject({ value: "limit", symbol: "AAPL" });
  });

  it("an orders table: the entry's row, with a bracket's exits left out", () => {
    const tv = [
      "Symbol Side Type Qty Limit Price Stop Price Fill Price Take Profit Stop Loss Status",
      "100 CME_MINI:NQ1! Buy Limit 1 24,985.00 25,259.25 24,704.25 Working 2025.",
      "100 CME_MINI:NQ1! Sell Stop Loss 24,704.25 Inactive 2025",
      "100 CME_MINI:NQ1! Sell Take Profit A 25,259.25 Inactive 2025.",
    ].join("\n");
    expect(type(tv)).toBe("limit");
    const ibkr = "Financial Instrument Action  Order Type Quantity Limit Price Stop Price Time in Force Fill Price Status\nAAPL BUY Limit 0/1 205.520 DAY Submitted\nTrades Summary Today";
    expect(type(ibkr)).toBe("limit");
    const portal = "ACTION QUANTITY ORDER TYPE LIMIT PRICE TIME-IN-FORCE OUTSIDE RTH\nBUY SELL 100 + Shares Limit 154.24 + Day No\n*15,422.00 USD Price Management";
    expect(type(portal)).toBe("limit");
  });

  it("chart labels and MetaTrader-style wording", () => {
    expect(type("Buy Limit 81.86\n80.00")).toBe("limit");
    expect(type("Buy S Limit 72.41")).toBe("limit");
    expect(type("6EZ5,Order 195822657964\nBuy Limit 1 @ 1.15040")).toBe("limit");
  });
});

describe("detectOrderType: never a guess", () => {
  it("a row of tabs or a menu of types says nothing", () => {
    expect(type("Buy Apple\nMarket Limit Stop Stop Limit\nStop 174.29\nLimit 178.64")).toBeNull(); // Trading 212
    expect(type("MARKET LIMIT STOP\nOrder Price\nTime in Force GTC")).toBeNull();
    expect(type("Limit Order\nStop Order Stop Loss: 0.00000\nStop Limit Order")).toBeNull(); // MT5 side menu
    expect(type("Sell Limit1 219.306\nBuyStop1 219.306")).toBeNull(); // MT5 chart menu
    expect(type("Sell 1K EURUSD @ 1.15290 limit S\nBuy 1K EURUSD @ 1.15290 stop 1.15250")).toBeNull();
    expect(type("Buy Mkt Sell Mkt")).toBeNull(); // DOM buttons
  });

  it("several different orders on one screen fill nothing", () => {
    const history = [
      "Symbol Side Type Qty Limit Price Stop Price Fill Price Status",
      "NASDAQ:AAPL Sell Stop 228.78 228.79 Filled 1:1 228.78 USD",
      "NASDAQ:AAPL Buy Market 228.90 Filled 1:1 228.90 USD",
      "NASDAQ:AAPL Buy Limit 232.94 232.94 Filled 1:1 232.94 USD",
    ].join("\n");
    expect(type(history)).toBeNull();
    // IBKR Desktop: an unreadable row ("Lmit") might be a different type.
    const ibkr = "Firun Action Order Type Quantty Limt Phoe SippPrion Time in Force FIPoe Saba\no  SPY Lmit 0/10 603.33 DAY suby bed\nGOOGL BUY Market WARKET DAY 195.72 Filled\nIBKR BUY Market 10 WARKET DAY 178.97 Flled";
    expect(type(ibkr)).toBeNull();
    // MT5: open positions (type "buy") and a pending buy limit.
    const mt5 = "Symbol Ticket Time Type Volume Price S/L T/P Price Profit\neurusd 328674 2026.06.22 14:49:50 buy 0.1 1.14590\neurusd 328863 2026.08.28 07:05:35 buy limit 0.01/0 1.16000 placed";
    expect(type(mt5)).toBeNull();
  });

  it("phrases that only contain a type word are not one", () => {
    expect(type("Stop Loss Type Stop\nStop Price\nLMT SL-STP")).toBeNull(); // IBKR attached stop-loss
    expect(type("Limit Price 154.24\nStop price Ticks\nMarket Value 46,268")).toBeNull();
    // E*TRADE's option ticket: its Type column is Call / Put.
    expect(type("Action Quantity Expiration Strike Type Bid x size Ask x size\nSell Close V 1 Jun 16 '23 Y 170 Call 5.80×731")).toBeNull();
  });
});
