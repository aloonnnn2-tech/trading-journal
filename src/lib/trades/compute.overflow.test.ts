import { describe, expect, it } from "vitest";
import { computeDerivedFields } from "./compute";
import { buildRowFromMapping } from "./import";
import { coreFieldsSchema } from "./schema";
import type { TradeCoreFields } from "./types";

// computeDerivedFields documents that it "never returns NaN/Infinity, only a
// number or null". It did, for finite inputs: price x shares can overflow, and
// Infinity then divides into NaN. Neither survives JSON.stringify on the way to
// Postgres -- both become null -- so a trade imported with absurd magnitudes was
// stored with a silently empty P/L and filed as break-even, while the import
// reported success.

function trade(over: Partial<TradeCoreFields>): TradeCoreFields {
  return { direction: "long", commission: null, ...over } as TradeCoreFields;
}

describe("computeDerivedFields never emits a non-finite number", () => {
  it("returns null rather than Infinity/NaN when price x shares overflows", () => {
    const d = computeDerivedFields(
      trade({ entry_price: 1e200, exit_price: 2e200, shares: 1e200, risk_amount: 1 }),
    );
    expect(d.dollar_pl).toBeNull();
    expect(d.percent_return).toBeNull();
    expect(d.r_multiple).toBeNull();
  });

  it("holds the contract across the whole edge matrix", () => {
    const cases: Partial<TradeCoreFields>[] = [
      { entry_price: 1e308, exit_price: -1e308, shares: 1e10, risk_amount: 1e-320 },
      { entry_price: 1e-320, exit_price: 1e-320, shares: 1e-320, risk_amount: 1e-320 },
      { entry_price: 0, exit_price: 0, shares: 0, risk_amount: 0 },
      { entry_price: Number.MAX_VALUE, exit_price: Number.MAX_VALUE, shares: 2, risk_amount: 1 },
    ];
    for (const c of cases) {
      const d = computeDerivedFields(trade(c));
      for (const [key, value] of Object.entries(d)) {
        if (value !== null) {
          expect(Number.isFinite(value), `${key} was ${value} for ${JSON.stringify(c)}`).toBe(true);
        }
      }
    }
  });

  // Ordinary trades must be completely unaffected by the guard.
  it("leaves a normal trade's numbers alone", () => {
    const d = computeDerivedFields(
      trade({ entry_price: 100, exit_price: 110, shares: 10, stop_loss: 95, take_profit: 120, risk_amount: 50 }),
    );
    expect(d.dollar_pl).toBe(100);
    expect(d.percent_return).toBe(10);
    expect(d.r_multiple).toBe(2);
    expect(d.risk_reward_ratio).toBe(4);
  });
});

describe("percent_return sign matches dollar_pl", () => {
  // A negative share count is not a valid short (that is `direction`), but
  // nothing rejects one. With a signed cost basis the same trade reported a
  // dollar loss and a positive percentage return simultaneously.
  it("reports a loss as a negative percentage when shares are negative", () => {
    const d = computeDerivedFields(trade({ entry_price: 100, exit_price: 110, shares: -10 }));
    expect(d.dollar_pl).toBe(-100);
    expect(d.percent_return).toBeLessThan(0);
    expect(Math.sign(d.percent_return!)).toBe(Math.sign(d.dollar_pl!));
  });

  it("keeps signs agreeing for an ordinary loss", () => {
    const d = computeDerivedFields(trade({ entry_price: 100, exit_price: 90, shares: 10 }));
    expect(Math.sign(d.percent_return!)).toBe(Math.sign(d.dollar_pl!));
  });
});

describe("oversized numbers are rejected at the entry points", () => {
  // Driven through the exported importer rather than the private parser, so
  // this exercises the path a real CSV upload takes.
  const mapping = {
    Ticker: "ticker",
    Entry: "entry_price",
    Exit: "exit_price",
    Qty: "shares",
  } as never;
  const build = (row: Record<string, string>) =>
    buildRowFromMapping({ Ticker: "AAPL", ...row } as never, mapping, new Map() as never);

  // Rejecting at parse time is what turns silent data loss into a row error
  // the user can actually see and act on.
  it("rejects a magnitude a double cannot represent, and says which field", () => {
    const built = build({ Entry: "1e200", Exit: "2e200", Qty: "1e200" });
    expect(built.error).toMatch(/too large/i);
    expect(built.error).toMatch(/entry_price/);
    expect(built.core.entry_price ?? null).toBeNull();
  });

  it("still accepts realistic values untouched", () => {
    const built = build({ Entry: "123.45", Exit: "130.5", Qty: "-10" });
    expect(built.error).toBeNull();
    expect(built.core.entry_price).toBe(123.45);
    expect(built.core.shares).toBe(-10);
  });

  it("the API schema rejects the same magnitude", () => {
    expect(coreFieldsSchema.safeParse({ entry_price: 1e200 }).success).toBe(false);
    expect(coreFieldsSchema.safeParse({ entry_price: 1234.56 }).success).toBe(true);
  });
});
