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
    from: (table: string) =>
      fakeTable((data as Record<string, Record<string, unknown>[]>)[table] ?? []),
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

describe("getAccountBalance with partial sells (0079)", () => {
  const sale = { id: "s1", date: "2026-10-20T15:00:00Z", shares: 40, price: 60, reason: "reduce_risk" };

  it("frees the sold part's cost and counts its profit at once", async () => {
    const supabase = fakeSupabase({
      account_transactions: [{ amount: 10000 }],
      trades: [
        {
          status: "open",
          mode: "trade",
          direction: "long",
          position_size: 5000,
          entry_price: 50,
          shares: 100,
          custom_fields: null,
          partial_exits: [sale],
        },
      ],
    });
    const result = await getAccountBalance(supabase);
    expect(result.tradePL).toBe(400); // 40 x (60 - 50)
    expect(result.balance).toBe(10400);
    expect(result.committedCash).toBe(3000); // 60% of 5,000 still held
    expect(result.availableCash).toBe(7400);
  });

  it("doesn't count an open trade's sales twice once it closes", async () => {
    const supabase = fakeSupabase({
      account_transactions: [{ amount: 10000 }],
      trades: [
        // dollar_pl already includes the sale (+400) and the rest (+300).
        { status: "closed", mode: "trade", dollar_pl: 700, partial_exits: [sale] },
      ],
    });
    const result = await getAccountBalance(supabase);
    expect(result.tradePL).toBe(700);
    expect(result.committedCash).toBe(0);
  });

  it("still works before 0079 is applied (no partial_exits column)", async () => {
    let first = true;
    const supabase = {
      from: (table: string) => {
        const rows =
          table === "trades"
            ? [{ status: "open", mode: "trade", position_size: 2000, entry_price: null, shares: null, custom_fields: null }]
            : [{ amount: 5000 }];
        const builder = fakeTable(rows);
        return {
          ...builder,
          select: (columns: string) => {
            if (table === "trades" && columns.includes("partial_exits") && first) {
              first = false;
              const failing = {
                in: () => failing,
                order: () => failing,
                range: () => Promise.resolve({ data: null, error: { code: "42703", message: "no column" } }),
              };
              return failing;
            }
            return builder;
          },
        };
      },
    } as unknown as SupabaseClient;
    const result = await getAccountBalance(supabase);
    expect(result.committedCash).toBe(2000);
  });
});
