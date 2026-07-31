import { describe, it, expect } from "vitest";
import { getMissingFields } from "./missing-fields";
import type { Trade } from "./types";

function trade(over: Partial<Trade> = {}): Trade {
  return {
    ticker: "AAPL",
    direction: "long",
    entry_price: 100,
    stop_loss: 95,
    entry_date: "2026-07-01T00:00:00Z",
    shares: 10,
    status: "open",
    exit_price: null,
    exit_date: null,
    position_size: null,
    dollar_amount: null,
    ...over,
  } as Trade;
}

const keys = (t: Trade, isInvestment = false, hidden: never[] = []) =>
  getMissingFields(t, isInvestment, hidden).map((f) => f.key);

describe("standard trades", () => {
  it("reports nothing when the required fields are filled", () => {
    expect(keys(trade())).toEqual([]);
  });

  it("names each missing required field", () => {
    expect(keys(trade({ ticker: "", direction: null, stop_loss: null }))).toEqual([
      "ticker",
      "direction",
      "stop_loss",
    ]);
  });

  it("requires entry date even while pending", () => {
    expect(keys(trade({ status: "pending", entry_date: null }))).toContain("entry_date");
  });

  it("asks for exit price and date once closed", () => {
    const missing = keys(trade({ status: "closed" }));
    expect(missing).toContain("exit_price");
    expect(missing).toContain("exit_date");
  });

  it("never asks for take profit — not every trade has a target", () => {
    expect(keys(trade({ take_profit: null } as Partial<Trade>))).not.toContain("take_profit");
  });
});

describe("position sizing is satisfied by any one field", () => {
  it("accepts shares alone", () => {
    expect(keys(trade({ shares: 10, position_size: null, dollar_amount: null }))).toEqual([]);
  });

  it("accepts position size alone", () => {
    expect(keys(trade({ shares: null, position_size: 1000, dollar_amount: null }))).toEqual([]);
  });

  it("asks once when all three are empty", () => {
    const missing = keys(trade({ shares: null, position_size: null, dollar_amount: null }));
    expect(missing).toEqual(["position_size"]);
  });
});

describe("hidden fields are not 'missing'", () => {
  it("skips a field the user removed from their card", () => {
    const hidden = ["stop_loss"] as unknown as never[];
    expect(keys(trade({ stop_loss: null }), false, hidden)).toEqual([]);
  });

  it("drops the sizing nag entirely when every sizing field is hidden", () => {
    const hidden = ["shares", "position_size", "dollar_amount"] as unknown as never[];
    expect(keys(trade({ shares: null, position_size: null, dollar_amount: null }), false, hidden)).toEqual([]);
  });
});

// Investment mode hides the whole Entry information card, so requiring
// entry price or sizing would nag for fields with no UI to fill in. This
// was a real shipped bug, fixed before release.
describe("investment mode", () => {
  it("only requires ticker and entry date", () => {
    const investment = trade({ direction: null, entry_price: null, stop_loss: null, shares: null });
    expect(keys(investment, true)).toEqual([]);
  });

  it("adds exit date, but not exit price, once closed", () => {
    const investment = trade({
      status: "closed",
      direction: null,
      entry_price: null,
      stop_loss: null,
      shares: null,
    });
    const missing = keys(investment, true);
    expect(missing).toEqual(["exit_date"]);
    expect(missing).not.toContain("exit_price");
  });

  it("still asks for the two fields it does own", () => {
    const investment = trade({ ticker: "", entry_date: null, direction: null, entry_price: null, stop_loss: null, shares: null });
    expect(keys(investment, true)).toEqual(["ticker", "entry_date"]);
  });
});
