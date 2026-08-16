import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { duplicateTrade } from "./queries";
import type { Trade } from "./types";

// Minimal fake covering exactly the two calls duplicateTrade makes:
// select().eq().maybeSingle() to load the source row, then
// insert().select().single() to create the copy. The insert fake echoes
// back whatever was inserted, matching how PostgREST's `.select()` after
// an insert returns the row as stored.
function fakeSupabase(existing: Trade): SupabaseClient {
  const from = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: existing, error: null }),
      }),
    }),
    insert: (row: Record<string, unknown>) => ({
      select: () => ({
        single: () => Promise.resolve({ data: row, error: null }),
      }),
    }),
  });
  return { from } as unknown as SupabaseClient;
}

function baseClosedTrade(): Trade {
  return {
    id: "source-id",
    user_id: "user-1",
    mode: "trade",
    ticker: "AAPL",
    company_name: null,
    asset_type: "Stock",
    market: "NASDAQ",
    direction: "long",
    status: "closed",
    result: "win",
    entry_price: 100,
    exit_price: 110,
    stop_loss: 95,
    take_profit: 120,
    shares: 10,
    position_size: 1000,
    dollar_amount: 1000,
    risk_amount: 50,
    risk_percent: 5,
    entry_date: "2026-01-01T00:00:00.000Z",
    exit_date: "2026-01-02T00:00:00.000Z",
    commission: 1.5,
    commission_manual: true,
    dollar_pl: 98.5,
    percent_return: 9.85,
    r_multiple: 2,
    risk_reward_ratio: 4,
    custom_fields: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    strategy_field_values: {},
  } as Trade;
}

describe("duplicateTrade", () => {
  it("resets status/result but clears every exit-dependent field", async () => {
    const supabase = fakeSupabase(baseClosedTrade());
    const copy = await duplicateTrade(supabase, "source-id");

    expect(copy.status).toBe("pending");
    expect(copy.result).toBe("open");
    expect(copy.exit_price).toBeNull();
    expect(copy.exit_date).toBeNull();
    expect(copy.commission).toBeNull();
    expect(copy.commission_manual).toBe(false);
    expect(copy.dollar_pl).toBeNull();
    expect(copy.percent_return).toBeNull();
    expect(copy.r_multiple).toBeNull();
    expect(copy.risk_reward_ratio).toBeNull();
  });

  it("still carries over entry-side fields that a pending order legitimately has", async () => {
    const supabase = fakeSupabase(baseClosedTrade());
    const copy = await duplicateTrade(supabase, "source-id");

    expect(copy.ticker).toBe("AAPL");
    expect(copy.entry_price).toBe(100);
    expect(copy.stop_loss).toBe(95);
    expect(copy.take_profit).toBe(120);
    expect(copy.shares).toBe(10);
    expect(copy.position_size).toBe(1000);
  });

  it("throws when the source trade doesn't exist", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(duplicateTrade(supabase, "missing-id")).rejects.toThrow("Trade not found");
  });
});
