import { describe, expect, it } from "vitest";
import { deriveMoneyFields, type MoneyFields } from "./derive-inputs";

const fields = (overrides: Partial<MoneyFields> = {}): MoneyFields => ({
  entry_price: null,
  shares: null,
  dollar_amount: null,
  stop_loss: null,
  risk_amount: null,
  ...overrides,
});

describe("dollar amount / shares", () => {
  it("fills the dollar amount from entry price x shares", () => {
    const r = deriveMoneyFields("shares", fields({ entry_price: 100, shares: 10 }), null);
    expect(r.dollar_amount).toBe(1000);
  });

  it("solves back for shares when the dollar amount is the field edited", () => {
    const r = deriveMoneyFields("dollar_amount", fields({ entry_price: 50, dollar_amount: 500 }), null);
    expect(r.shares).toBe(10);
    // The field the user just typed is never written back over.
    expect(r.dollar_amount).toBeUndefined();
  });

  // Regression: this fallback exists in the Quick Trade dialog
  // (handleEntryPriceChange's else-if) but was missing here -- typing a
  // dollar amount first, then an entry price, silently left shares blank
  // on the trade page while the dialog would have solved it.
  it("editing entry price also solves for shares when a dollar amount was typed first", () => {
    const r = deriveMoneyFields("entry_price", fields({ entry_price: 50, dollar_amount: 500 }), null);
    expect(r.shares).toBe(10);
  });

  it("entry price of exactly 0 derives nothing, matching the dialog's guard", () => {
    // QuickTradeButton.handleEntryPriceChange returns early entirely on
    // price === 0 (a price of literally zero isn't a real price yet).
    expect(deriveMoneyFields("entry_price", fields({ entry_price: 0, shares: 10 }), null)).toEqual({});
    expect(deriveMoneyFields("entry_price", fields({ entry_price: 0, dollar_amount: 500 }), null)).toEqual({});
  });

  it("doesn't rewrite a hand-entered dollar amount when an unrelated field is edited", () => {
    // 1005 rather than the 1000 entry x shares implies -- the user has
    // accounted for something the app can't see, and editing a stop must
    // not quietly round it away.
    const manual = fields({ entry_price: 100, shares: 10, dollar_amount: 1005, stop_loss: 95 });
    expect(deriveMoneyFields("stop_loss", manual, null).dollar_amount).toBeUndefined();
    expect(deriveMoneyFields("risk_amount", manual, null).dollar_amount).toBeUndefined();
  });

  it("still recomputes it when one of its own inputs moves", () => {
    const manual = fields({ entry_price: 100, shares: 20, dollar_amount: 1005 });
    expect(deriveMoneyFields("shares", manual, null).dollar_amount).toBe(2000);
    expect(deriveMoneyFields("entry_price", manual, null).dollar_amount).toBe(2000);
  });

  it("leaves size alone when only one side is known", () => {
    const r = deriveMoneyFields("entry_price", fields({ entry_price: 100 }), null);
    expect(r.dollar_amount).toBeUndefined();
  });

  it("doesn't divide by a zero entry price", () => {
    const r = deriveMoneyFields("dollar_amount", fields({ entry_price: 0, dollar_amount: 500 }), null);
    expect(r.shares).toBeUndefined();
  });

  it("rounds fractional share counts rather than storing float noise", () => {
    const r = deriveMoneyFields("dollar_amount", fields({ entry_price: 3, dollar_amount: 100 }), null);
    expect(r.shares).toBe(33.3333);
  });
});

describe("risk amount", () => {
  it("is the stop distance across the position", () => {
    const r = deriveMoneyFields("stop_loss", fields({ entry_price: 100, stop_loss: 95, shares: 10 }), null);
    expect(r.risk_amount).toBe(50);
  });

  it("works the same for a stop above entry (a short)", () => {
    const r = deriveMoneyFields("stop_loss", fields({ entry_price: 100, stop_loss: 105, shares: 10 }), null);
    expect(r.risk_amount).toBe(50);
  });

  it("stays out of the way until every input is present", () => {
    const r = deriveMoneyFields("entry_price", fields({ entry_price: 100, stop_loss: 95 }), null);
    expect(r.risk_amount).toBeUndefined();
  });

  it("never overwrites the risk amount being typed", () => {
    const r = deriveMoneyFields(
      "risk_amount",
      fields({ entry_price: 100, stop_loss: 95, shares: 10, risk_amount: 25 }),
      null,
    );
    expect(r.risk_amount).toBeUndefined();
  });

  it("follows shares derived in the same edit", () => {
    const r = deriveMoneyFields(
      "dollar_amount",
      fields({ entry_price: 50, dollar_amount: 500, stop_loss: 45 }),
      null,
    );
    expect(r.shares).toBe(10);
    expect(r.risk_amount).toBe(50); // |50 - 45| x the 10 shares just derived
  });
});

describe("risk percent", () => {
  it("is the risk against the account balance", () => {
    const r = deriveMoneyFields("stop_loss", fields({ entry_price: 100, stop_loss: 95, shares: 10 }), 5000);
    expect(r.risk_percent).toBe(1);
  });

  it("is left alone without a funded account", () => {
    const r = deriveMoneyFields("stop_loss", fields({ entry_price: 100, stop_loss: 95, shares: 10 }), null);
    expect(r.risk_percent).toBeUndefined();
  });

  it("is left alone on a zero or negative balance rather than dividing by it", () => {
    expect(
      deriveMoneyFields("stop_loss", fields({ entry_price: 100, stop_loss: 95, shares: 10 }), 0).risk_percent,
    ).toBeUndefined();
    expect(
      deriveMoneyFields("stop_loss", fields({ entry_price: 100, stop_loss: 95, shares: 10 }), -20).risk_percent,
    ).toBeUndefined();
  });

  it("follows a hand-typed risk amount", () => {
    const r = deriveMoneyFields("risk_amount", fields({ risk_amount: 250 }), 10000);
    expect(r.risk_percent).toBe(2.5);
  });
});

describe("unrelated fields", () => {
  it("derives nothing when the edit can't affect any of them", () => {
    expect(deriveMoneyFields("ticker", fields({ entry_price: 100, shares: 10 }), 5000)).toEqual({});
    expect(deriveMoneyFields("exit_price", fields({ entry_price: 100, shares: 10 }), 5000)).toEqual({});
  });
});
