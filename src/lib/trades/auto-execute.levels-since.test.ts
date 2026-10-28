import { describe, expect, it } from "vitest";
import { decideAutoExecution, minuteBarsNeededSince, type AutoExecutableTrade } from "./auto-execute";

// Alon, 2026-10-28: "I enter a stock, it goes up, I set my stop above my
// entry, and Trading Lens takes that as getting out of the stock." The day's
// low came from BEFORE the stop was moved. A level is now judged only on
// prices since it was set (and since the position opened).

const NOW = new Date("2026-10-28T18:00:00Z");
const at = (iso: string) => Date.parse(iso) / 1000;
const minutes = (startIso: string, prices: number[]) =>
  prices.map((p, i) => ({ time: at(startIso) + i * 60, high: p, low: p }));

function longTrade(over: Partial<AutoExecutableTrade> = {}): AutoExecutableTrade {
  return {
    mode: "trade",
    status: "open",
    direction: "long",
    entry_price: 100,
    stop_loss: 105,
    take_profit: 130,
    entry_date: "2026-10-28T14:00:00Z", // bought today
    stop_loss_set_at: "2026-10-28T17:00:00Z", // stop raised above the entry later today
    ...over,
  } as AutoExecutableTrade;
}

// Today: bought at 100, dipped to 99 before the rally, now 110.
const today = { dayLow: 99, dayHigh: 111, currentPrice: 110, quoteTime: NOW };

describe("a stop moved above the entry after a rally", () => {
  it("is NOT hit by the dip from before it was moved (the reported bug)", () => {
    const bars = minutes("2026-10-28T17:00:00Z", [109, 110, 108, 110, 110]);
    expect(decideAutoExecution(longTrade(), { ...today, minuteBars: bars }, NOW)).toBeNull();
  });

  it("IS hit when price really falls through it after it was moved", () => {
    const bars = minutes("2026-10-28T17:00:00Z", [109, 107, 104.5, 106]);
    const d = decideAutoExecution(longTrade(), { ...today, currentPrice: 106, minuteBars: bars }, NOW);
    expect(d?.trigger).toBe("stop_loss");
    expect(d?.changes.exit_price).toBe(105);
  });

  it("ignores the bar the stop was set in (it holds the seconds before the change)", () => {
    const set = "2026-10-28T17:00:30Z";
    const bars = [
      { time: at("2026-10-28T17:00:00Z"), high: 110, low: 99 }, // includes pre-change prices
      ...minutes("2026-10-28T17:01:00Z", [109, 110]),
    ];
    expect(decideAutoExecution(longTrade({ stop_loss_set_at: set }), { ...today, minuteBars: bars }, NOW)).toBeNull();
  });

  it("on the trade page (no bars), reacts only when the live price crosses it", () => {
    expect(decideAutoExecution(longTrade(), today, NOW)).toBeNull();
    const d = decideAutoExecution(longTrade(), { ...today, currentPrice: 104 }, NOW);
    expect(d?.trigger).toBe("stop_loss");
  });

  it("decides nothing for a recent level when there are neither bars nor a live price", () => {
    expect(decideAutoExecution(longTrade(), { dayLow: 99, dayHigh: 111, quoteTime: NOW }, NOW)).toBeNull();
  });

  it("a stop set more than a day ago still uses the whole day's range, as before", () => {
    const d = decideAutoExecution(
      longTrade({ entry_date: "2026-10-20T14:00:00Z", stop_loss_set_at: "2026-10-26T15:00:00Z" }),
      today,
      NOW,
    );
    expect(d?.trigger).toBe("stop_loss");
  });

  it("trades from before levels were tracked behave exactly as before", () => {
    const d = decideAutoExecution(
      longTrade({ entry_date: "2026-10-01T14:00:00Z", stop_loss_set_at: null }),
      today,
      NOW,
    );
    expect(d?.trigger).toBe("stop_loss");
  });
});

describe("prices from before the position opened never count", () => {
  it("a stop set long ago isn't hit by a pre-entry dip on the day it filled", () => {
    // Stop placed with the order last week; the order filled at 14:00 today.
    const trade = longTrade({ stop_loss: 98, stop_loss_set_at: "2026-10-20T14:00:00Z" });
    const morningDip = { dayLow: 97, dayHigh: 111, currentPrice: 110, quoteTime: NOW };
    const bars = minutes("2026-10-28T14:00:00Z", [100, 103, 108, 110]);
    expect(decideAutoExecution(trade, { ...morningDip, minuteBars: bars }, NOW)).toBeNull();
  });
});

describe("a take-profit lowered after a spike", () => {
  it("isn't hit by the spike from before it was lowered", () => {
    const trade = longTrade({ stop_loss: 90, take_profit: 115, take_profit_set_at: "2026-10-28T17:00:00Z" });
    const spikedEarlier = { dayLow: 99, dayHigh: 120, currentPrice: 110, quoteTime: NOW };
    const bars = minutes("2026-10-28T17:00:00Z", [110, 111, 112]);
    expect(decideAutoExecution(trade, { ...spikedEarlier, minuteBars: bars }, NOW)).toBeNull();
    const reached = minutes("2026-10-28T17:00:00Z", [110, 113, 115.2]);
    expect(decideAutoExecution(trade, { ...spikedEarlier, minuteBars: reached }, NOW)?.trigger).toBe("take_profit");
  });
});

describe("shorts, the mirror image", () => {
  it("a stop lowered below the entry after a drop isn't hit by the earlier high", () => {
    const short = longTrade({
      direction: "short",
      entry_price: 100,
      stop_loss: 95,
      take_profit: 70,
      stop_loss_set_at: "2026-10-28T17:00:00Z",
    });
    const dayRange = { dayLow: 89, dayHigh: 101, currentPrice: 90, quoteTime: NOW };
    expect(
      decideAutoExecution(short, { ...dayRange, minuteBars: minutes("2026-10-28T17:00:00Z", [91, 90, 92]) }, NOW),
    ).toBeNull();
    expect(
      decideAutoExecution(short, { ...dayRange, minuteBars: minutes("2026-10-28T17:00:00Z", [91, 96]) }, NOW)?.trigger,
    ).toBe("stop_loss");
  });
});

describe("a pending order placed in the middle of the day", () => {
  it("doesn't fill on a low from before it was placed", () => {
    const order = longTrade({
      status: "pending",
      order_type: "limit",
      entry_price: 100,
      entry_date: null,
      created_at: "2026-10-28T17:00:00Z",
    });
    const morning = { dayLow: 98, dayHigh: 111, currentPrice: 110, quoteTime: NOW };
    expect(
      decideAutoExecution(order, { ...morning, minuteBars: minutes("2026-10-28T17:00:00Z", [109, 108]) }, NOW),
    ).toBeNull();
    expect(
      decideAutoExecution(order, { ...morning, minuteBars: minutes("2026-10-28T17:00:00Z", [104, 99.9]) }, NOW)?.trigger,
    ).toBe("entry");
  });

  it("an order whose limit was changed today counts only prices since the change", () => {
    const order = longTrade({
      status: "pending",
      order_type: "limit",
      entry_price: 100,
      entry_date: null,
      created_at: "2026-10-20T17:00:00Z",
      entry_levels_set_at: "2026-10-28T17:00:00Z",
    });
    const morning = { dayLow: 98, dayHigh: 111, currentPrice: 110, quoteTime: NOW };
    expect(
      decideAutoExecution(order, { ...morning, minuteBars: minutes("2026-10-28T17:00:00Z", [109]) }, NOW),
    ).toBeNull();
  });
});

describe("minuteBarsNeededSince", () => {
  it("asks for bars from the earliest recent level of an open trade", () => {
    const t = longTrade({ take_profit_set_at: "2026-10-28T16:00:00Z" });
    expect(minuteBarsNeededSince(t, NOW)).toBe(Date.parse("2026-10-28T16:00:00Z"));
  });

  it("never reaches back before the position opened", () => {
    const t = longTrade({ stop_loss_set_at: "2026-10-27T10:00:00Z", take_profit_set_at: null });
    expect(minuteBarsNeededSince(t, NOW)).toBe(Date.parse("2026-10-28T14:00:00Z"));
  });

  it("needs none when every level is older than a day", () => {
    const t = longTrade({ entry_date: "2026-10-01T00:00:00Z", stop_loss_set_at: "2026-10-02T00:00:00Z", take_profit_set_at: null });
    expect(minuteBarsNeededSince(t, NOW)).toBeNull();
  });

  it("for a pending order: since it was placed or last changed", () => {
    const t = longTrade({ status: "pending", entry_date: null, created_at: "2026-10-28T15:00:00Z" });
    expect(minuteBarsNeededSince(t, NOW)).toBe(Date.parse("2026-10-28T15:00:00Z"));
  });
});
