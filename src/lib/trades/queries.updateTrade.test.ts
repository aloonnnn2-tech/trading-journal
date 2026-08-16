import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateTrade } from "./queries";
import type { Trade } from "./types";

// Simulates the migration-0022-not-yet-applied window: the first update
// (with commission columns) fails with a "missing column" error exactly
// like PostgREST's real one, forcing the documented retry-without-
// commission fallback.
function fakeSupabase(existing: Trade): SupabaseClient {
  let updateCallCount = 0;
  const from = (table: string) => {
    if (table === "trades") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: existing, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: () => ({
            select: () => ({
              single: () => {
                updateCallCount += 1;
                if (updateCallCount === 1) {
                  return Promise.resolve({
                    data: null,
                    error: { code: "PGRST204", message: "column not found" },
                  });
                }
                return Promise.resolve({ data: payload, error: null });
              },
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  };
  return { from } as unknown as SupabaseClient;
}

function closedTradeAboutToRecloseTrade(): Trade {
  return {
    id: "trade-1",
    user_id: "user-1",
    mode: "trade",
    ticker: "AAPL",
    company_name: null,
    asset_type: "Stock",
    market: "NASDAQ",
    direction: "long",
    status: "closed",
    result: "open",
    entry_price: 100,
    exit_price: 101,
    stop_loss: null,
    take_profit: null,
    shares: 10,
    position_size: 1000,
    dollar_amount: 1000,
    risk_amount: null,
    risk_percent: null,
    entry_date: "2026-01-01T00:00:00.000Z",
    exit_date: "2026-01-02T00:00:00.000Z",
    commission: 15,
    // Manual so updateTrade skips the commission_rules fetch entirely --
    // this test isn't exercising that path.
    commission_manual: true,
    dollar_pl: null,
    percent_return: null,
    r_multiple: null,
    risk_reward_ratio: null,
    custom_fields: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    strategy_field_values: {},
  } as Trade;
}

describe("updateTrade's missing-column retry path", () => {
  it("re-derives result from the gross P&L it actually persists, not the stale commission-net one", async () => {
    // Gross: (101 - 100) * 10 = +10 (a win). Net of the $15 commission:
    // 10 - 15 = -5 (a loss) -- exactly the "thin win a fee turns into a
    // loss" case resultForClosedTrade exists to handle. The retry drops
    // the commission entirely (the columns don't exist yet), so its
    // dollar_pl is the gross +10 -- result must follow that, not stay
    // pinned at the "loss" the first, commission-net attempt decided.
    const supabase = fakeSupabase(closedTradeAboutToRecloseTrade());

    const result = await updateTrade(supabase, "trade-1", { core: {} });

    expect(result.dollar_pl).toBe(10);
    expect(result.result).toBe("win");
  });

  it("still respects an explicitly set result even through the retry", async () => {
    const supabase = fakeSupabase(closedTradeAboutToRecloseTrade());

    const result = await updateTrade(supabase, "trade-1", {
      core: { result: "break_even" },
    });

    expect(result.result).toBe("break_even");
  });
});
