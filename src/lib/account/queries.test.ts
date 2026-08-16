import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountBalance } from "./queries";

// Minimal fake of the PostgREST query-builder chain getAccountBalance
// actually uses (select/eq/in/not/order/range), applied against an in-memory
// row set. Each `.from(table)` call gets its own filter state, matching real
// Supabase where the builder isn't shared across calls.
function fakeTable(rows: Record<string, unknown>[]) {
  let filtered = rows;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return builder;
    },
    in: (col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => vals.includes(r[col]));
      return builder;
    },
    not: (col: string, op: string, val: unknown) => {
      if (op === "is" && val === null) {
        filtered = filtered.filter((r) => r[col] !== null && r[col] !== undefined);
      }
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) =>
      Promise.resolve({ data: filtered.slice(from, to + 1), error: null }),
  };
  return builder;
}

function fakeSupabase(data: {
  account_transactions?: Record<string, unknown>[];
  trades?: Record<string, unknown>[];
}): SupabaseClient {
  return {
    from: (table: string) => fakeTable((data as Record<string, unknown[]>)[table] ?? []),
  } as unknown as SupabaseClient;
}

describe("getAccountBalance", () => {
  it("sums deposits/withdrawals and realized P/L from closed trades only", async () => {
    const supabase = fakeSupabase({
      account_transactions: [{ amount: 10000 }, { amount: -2000 }],
      trades: [
        { status: "closed", dollar_pl: 500 },
        { status: "closed", dollar_pl: -100 },
        // Has a computed dollar_pl but isn't closed yet -- must not count as realized.
        { status: "open", dollar_pl: 9999 },
      ],
    });

    const result = await getAccountBalance(supabase);
    expect(result.deposited).toBe(8000);
    expect(result.tradePL).toBe(400);
    expect(result.balance).toBe(8400);
  });

  it("counts pending orders' reserved size as committed cash, not just open positions", async () => {
    // Regression test: a pending limit/stop order already has a position_size
    // set aside for it (see scripts/seed-fake-data.mjs, which seeds pending
    // trades with position_size too) -- excluding "pending" from committed
    // cash let availableCash and the new-trade prefill overstate what's
    // actually free, since that money is already earmarked once the order
    // triggers.
    const supabase = fakeSupabase({
      account_transactions: [{ amount: 10000 }],
      trades: [
        { status: "open", mode: "trade", position_size: 3000, entry_price: null, shares: null, custom_fields: null },
        { status: "pending", mode: "trade", position_size: 2000, entry_price: null, shares: null, custom_fields: null },
        // Closed trades never reserve cash, regardless of position_size.
        { status: "closed", mode: "trade", position_size: 5000, entry_price: null, shares: null, custom_fields: null, dollar_pl: 0 },
      ],
    });

    const result = await getAccountBalance(supabase);
    expect(result.committedCash).toBe(5000);
    expect(result.availableCash).toBe(10000 - 5000);
  });

  it("falls back to entry_price * shares when position_size is unset", async () => {
    const supabase = fakeSupabase({
      account_transactions: [],
      trades: [
        { status: "open", mode: "trade", position_size: null, entry_price: 50, shares: 20, custom_fields: null },
        { status: "pending", mode: "trade", position_size: null, entry_price: 100, shares: 10, custom_fields: null },
      ],
    });

    const result = await getAccountBalance(supabase);
    expect(result.committedCash).toBe(50 * 20 + 100 * 10);
  });

  it("prices investment-mode positions from average_cost * total_shares, open and pending alike", async () => {
    const supabase = fakeSupabase({
      account_transactions: [],
      trades: [
        {
          status: "open",
          mode: "investment",
          position_size: null,
          entry_price: null,
          shares: null,
          custom_fields: { average_cost: 100, total_shares: 5 },
        },
        {
          status: "pending",
          mode: "investment",
          position_size: null,
          entry_price: null,
          shares: null,
          custom_fields: { average_cost: 50, total_shares: 4 },
        },
      ],
    });

    const result = await getAccountBalance(supabase);
    expect(result.committedCash).toBe(100 * 5 + 50 * 4);
  });

  it("reports hasTransactions and a zeroed balance when the ledger is empty", async () => {
    const supabase = fakeSupabase({ account_transactions: [], trades: [] });
    const result = await getAccountBalance(supabase);
    expect(result.hasTransactions).toBe(false);
    expect(result.balance).toBe(0);
    expect(result.committedCash).toBe(0);
    expect(result.availableCash).toBe(0);
  });
});
