import { describe, expect, it } from "vitest";
import { findDirection, findStatus, normalizeOrderType, normalizeTimeInForce } from "./labels";
import { orderTypeFromSummary, resolveOrderFields, warningsFor } from "./resolve";
import { shouldAutofill, type DetectedField, type DetectedFields } from "./types";

const f = (key: DetectedField["key"], value: string | number, extra: Partial<DetectedField> = {}): DetectedField => ({
  key,
  value,
  confidence: 0.95,
  source: "beside its label",
  ...extra,
});

describe("never guess: ambiguous words become suggestions", () => {
  it("a bare 'Sell' is not a short trade any more", () => {
    const d = findDirection(["AAPL", "Sell 100 @ 190.10"]);
    expect(d).toMatchObject({ value: "long", ambiguous: true });
  });

  it("explicit phrasing still answers", () => {
    expect(findDirection(["Sell Short 100 TSLA"])).toMatchObject({ value: "short" });
    expect(findDirection(["Buy to cover 100"])).toMatchObject({ value: "short" });
    expect(findDirection(["Sell to close 2 contracts"])).toMatchObject({ value: "long" });
    expect(findDirection(["Buy 10 AAPL"])).toMatchObject({ value: "long" });
    expect(findDirection(["Buy 10 AAPL"])?.ambiguous).toBeUndefined();
  });

  it("'Filled' is not 'Closed': a filled buy opens a trade", () => {
    expect(findStatus(["Order Filled", "Buy 10"])).toMatchObject({ value: "open", ambiguous: true });
    expect(findStatus(["Status: Working"])).toMatchObject({ value: "pending" });
    expect(findStatus(["Position closed", "Realized P&L"])).toMatchObject({ value: "closed" });
  });

  it("a suggestion is never auto-filled, however confident", () => {
    expect(shouldAutofill({ confidence: 0.99, heuristic: true })).toBe(false);
    expect(shouldAutofill({ confidence: 0.9 })).toBe(true);
    expect(shouldAutofill({ confidence: 0.5 })).toBe(false);
    expect(shouldAutofill(undefined)).toBe(false);
  });
});

describe("order type and time in force", () => {
  it.each([
    ["LMT", "limit"],
    ["Limit", "limit"],
    ["MKT", "market"],
    ["STP", "stop"],
    ["Stop Limit", "stop_limit"],
    ["STP LMT", "stop_limit"],
    ["Trailing Stop", "trailing_stop"],
    ["MOC", "other"],
  ])("%s -> %s", (text, value) => {
    expect(normalizeOrderType(text)?.value).toBe(value);
  });

  it("refuses anything that isn't an order type (the old 'Tick value 0.01 USD' bug)", () => {
    expect(normalizeOrderType("Tick value 0.01 USD")).toBeNull();
    expect(normalizeOrderType("Buy")).toBeNull();
  });

  it("reads time in force", () => {
    expect(normalizeTimeInForce("Good Till Cancel")).toBe("gtc");
    expect(normalizeTimeInForce("GoodTill Cancel")).toBe("gtc");
    expect(normalizeTimeInForce("GTC")).toBe("gtc");
    expect(normalizeTimeInForce("Day")).toBe("day");
    expect(normalizeTimeInForce("GTD")).toBeNull();
  });

  it("reads the order summary line, glued or not", () => {
    expect(orderTypeFromSummary("10AAPL@278.00LMT")).toMatchObject({ value: "limit", symbol: "AAPL" });
    expect(orderTypeFromSummary("0.2626TXT@95.20STOP")).toMatchObject({ value: "stop", symbol: "TXT" });
    expect(orderTypeFromSummary("10SPYMKT")).toMatchObject({ value: "market", symbol: "SPY" });
    expect(orderTypeFromSummary("Tick value 0.01 USD")).toBeNull();
  });
});

describe("resolveOrderFields: what an order's prices mean", () => {
  it("a stop order's stop price is its entry (as a suggestion), not a stop-loss", () => {
    const fields: DetectedFields = { order_type: f("order_type", "STP"), stop_price: f("stop_price", 25.58) };
    const r = resolveOrderFields(fields).fields;
    expect(r.entry_price).toMatchObject({ value: 25.58, heuristic: true });
    expect(r.stop_loss).toBeUndefined();
  });

  it("a limit order's limit price is its entry (as a suggestion), not a take-profit", () => {
    const r = resolveOrderFields({ order_type: f("order_type", "LMT"), limit_price: f("limit_price", 56) }).fields;
    expect(r.entry_price).toMatchObject({ value: 56, heuristic: true });
    expect(r.take_profit).toBeUndefined();
    expect(r.limit_price).toBeUndefined();
  });

  it("a stop-limit keeps its limit price as the limit price", () => {
    const r = resolveOrderFields({ order_type: f("order_type", "Stop Limit"), limit_price: f("limit_price", 101) }).fields;
    expect(r.limit_price).toMatchObject({ value: 101 });
    expect(r.order_type?.value).toBe("stop_limit");
  });

  it("in a 'Take-Profit Order' / 'Stop-Loss Order' dialog the prices are the target and stop", () => {
    const raw = "Take-Profit Order\nLimit Price 10.50\nStop-Loss Order\nStop Price 9.50";
    const r = resolveOrderFields({ limit_price: f("limit_price", 10.5), stop_price: f("stop_price", 9.5) }, raw).fields;
    expect(r.take_profit).toMatchObject({ value: 10.5 });
    expect(r.stop_loss).toMatchObject({ value: 9.5 });
    expect(r.take_profit?.heuristic).toBeUndefined();
  });

  it("an unknown order type's stop price is only a stop-loss suggestion", () => {
    const r = resolveOrderFields({ stop_price: f("stop_price", 59.5) }).fields;
    expect(r.stop_loss).toMatchObject({ value: 59.5, heuristic: true });
  });

  it("an unrecognised order type is dropped with a note, never stored as text", () => {
    const r = resolveOrderFields({ order_type: f("order_type", "Tick value 0.01 USD") });
    expect(r.fields.order_type).toBeUndefined();
    expect(r.notes[0]).toMatchObject({ field: "order_type", ok: false });
  });

  it("stop above and target below the entry settle an ambiguous 'Sell' as short", () => {
    const r = resolveOrderFields({
      direction: f("direction", "long", { heuristic: true, confidence: 0.4 }),
      entry_price: f("entry_price", 5320.25),
      stop_loss: f("stop_loss", 5335.5),
      take_profit: f("take_profit", 5290),
    }).fields;
    expect(r.direction).toMatchObject({ value: "short", confidence: 0.8 });
    expect(r.direction?.heuristic).toBeUndefined();
  });

  it("does not deduce a side from suggestions or contradictory prices", () => {
    const sugg = resolveOrderFields({
      entry_price: f("entry_price", 100, { heuristic: true }),
      stop_loss: f("stop_loss", 95),
      take_profit: f("take_profit", 110),
    }).fields;
    expect(sugg.direction).toBeUndefined();
    const contradictory = resolveOrderFields({
      entry_price: f("entry_price", 100),
      stop_loss: f("stop_loss", 105),
      take_profit: f("take_profit", 110),
    }).fields;
    expect(contradictory.direction).toBeUndefined();
  });

  it("the order summary's symbol beats a weak header read", () => {
    const r = resolveOrderFields({ ticker: f("ticker", "SSPY", { source: "header symbol" }) }, "Buy\n10SPYMKT").fields;
    expect(r.ticker?.value).toBe("SPY");
    const strong = resolveOrderFields({ ticker: f("ticker", "QQQ", { source: "Ticker label" }) }, "10SPYMKT").fields;
    expect(strong.ticker?.value).toBe("QQQ");
  });
});

describe("warningsFor", () => {
  it("turns failed checks into sentences and flags cancelled orders", () => {
    const w = warningsFor(
      [
        { field: "cross", ok: false, message: "Entry×Shares ≠ position_size (100.00 vs 150.00)" },
        { field: "cross", ok: true, message: "fine" },
        { field: "cross", ok: false, message: "long: SL/TP on the wrong side of entry" },
      ],
      "Order Cancelled",
    );
    expect(w[0]).toMatch(/cancelled/);
    expect(w).toContain("Entry × shares doesn't match the total shown (100.00 vs 150.00). One of those numbers may be misread.");
    expect(w.some((s) => /wrong side/.test(s))).toBe(true);
    expect(w).toHaveLength(3);
  });

  it("a ticket explaining that an order WILL be cancelled is not a cancelled order", () => {
    const webull = "Time-in-Force Day\nThe order will be canceled after the market closes at 4:00 p.m.\nIf the order has not been filled, it will be canceled up to 60";
    expect(warningsFor([], webull)).toEqual([]);
    // The live reader can wrap the sentence mid-phrase.
    expect(warningsFor([], "The order will be\ncanceled after the market closes")).toEqual([]);
    expect(warningsFor([], "Time-in-Force\nDay\nGood 'Til Canceled\nGood Till Cancelled")).toEqual([]);
    expect(warningsFor([], "NASDAQ:AAPL Sell Stop 229.11 Cancelled 1:1")[0]).toMatch(/cancelled/);
  });
});

describe("findTicker's last-resort guess", () => {
  it("never takes a time zone for a ticker (Webull's '4:00 p.m. ET')", async () => {
    const { findTicker } = await import("./labels");
    expect(findTicker(["Individual ********", "Side Buy Sell", "ET on the same day for regular trading days."])).toBeNull();
    expect(findTicker(["AAPL 190.12", "closes at 4:00 p.m. ET"])?.value).toBe("AAPL");
  });
});
