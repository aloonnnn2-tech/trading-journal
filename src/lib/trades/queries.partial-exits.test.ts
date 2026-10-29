import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PartialExitsError, updateTrade } from "./queries";
import type { PartialExit, Trade } from "./types";

// A trades table of one row whose conditional write (.eq("updated_at"))
// succeeds, records the payload and stores it -- so a write that races
// another can be simulated by changing `row` between read and write.
function fakeSupabase(initial: Trade, opts: { raceOnce?: (row: Trade) => Trade } = {}) {
  let row = initial;
  let race = opts.raceOnce;
  const writes: Record<string, unknown>[] = [];
  const from = (table: string) => {
    if (table === "trades") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              const read = row;
              // Someone else writes right after this read.
              if (race) {
                row = race(row);
                race = undefined;
              }
              return Promise.resolve({ data: read, error: null });
            },
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: () => ({
            eq: (_col: string, updatedAt: string) => ({
              select: () => ({
                maybeSingle: () => {
                  if (updatedAt !== row.updated_at) return Promise.resolve({ data: null, error: null });
                  writes.push(payload);
                  row = { ...row, ...payload, updated_at: `${row.updated_at}+` } as Trade;
                  return Promise.resolve({ data: row, error: null });
                },
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  };
  return { client: { from } as unknown as SupabaseClient, writes, current: () => row };
}

function sale(over: Partial<PartialExit> = {}): PartialExit {
  return { id: "s1", date: "2026-10-20T15:00:00.000Z", shares: 40, price: 60, reason: "earnings", ...over };
}

function openTrade(over: Partial<Trade> = {}): Trade {
  return {
    id: "trade-1",
    user_id: "user-1",
    mode: "trade",
    ticker: "AAPL",
    company_name: null,
    asset_type: null,
    market: null,
    direction: "long",
    status: "open",
    result: "open",
    order_type: null,
    order_type_other: null,
    limit_price: null,
    time_in_force: "gtc",
    entry_price: 50,
    exit_price: null,
    stop_loss: 45,
    take_profit: null,
    shares: 100,
    position_size: 5000,
    dollar_amount: 5000,
    risk_amount: 500,
    risk_percent: null,
    entry_date: "2026-10-15T14:30:00.000Z",
    exit_date: null,
    // Manual so no commission_rules read is needed.
    commission: 0,
    commission_manual: true,
    dollar_pl: null,
    percent_return: null,
    r_multiple: null,
    risk_reward_ratio: null,
    custom_fields: {},
    strategy_field_values: {},
    partial_exits: [],
    created_at: "2026-10-15T14:30:00.000Z",
    updated_at: "v1",
    ...over,
  };
}

describe("updateTrade with partial sells", () => {
  it("saves a sale and leaves an open trade's P&L empty", async () => {
    const db = fakeSupabase(openTrade());
    const saved = await updateTrade(db.client, "trade-1", { partialExits: (cur) => [...cur, sale()] });
    expect(saved.partial_exits).toEqual([sale()]);
    expect(saved.dollar_pl).toBeNull();
  });

  it("closing the rest counts the sales in the P&L (the worked example)", async () => {
    const db = fakeSupabase(openTrade({ partial_exits: [sale()] }));
    const saved = await updateTrade(db.client, "trade-1", {
      core: { status: "closed", exit_price: 55, exit_date: "2026-10-25T15:00:00.000Z" },
    });
    expect(saved.dollar_pl).toBe(700);
    expect(saved.result).toBe("win");
    // A core edit doesn't rewrite the sales.
    expect(db.writes[0]).not.toHaveProperty("partial_exits");
  });

  it("applies the change to the row as saved now, so two sales logged at once both land", async () => {
    const db = fakeSupabase(openTrade(), {
      raceOnce: (row) => ({ ...row, partial_exits: [sale({ id: "other", shares: 10 })], updated_at: "v2" }),
    });
    const saved = await updateTrade(db.client, "trade-1", { partialExits: (cur) => [...cur, sale()] });
    expect(saved.partial_exits?.map((s) => s.id).sort()).toEqual(["other", "s1"]);
  });

  it("refuses selling more than held, and writes nothing", async () => {
    const db = fakeSupabase(openTrade({ partial_exits: [sale({ shares: 70 })] }));
    await expect(
      updateTrade(db.client, "trade-1", { partialExits: (cur) => [...cur, sale({ id: "s2", shares: 40 })] }),
    ).rejects.toBeInstanceOf(PartialExitsError);
    expect(db.writes).toHaveLength(0);
  });

  it("refuses lowering the share count below what was sold", async () => {
    const db = fakeSupabase(openTrade({ partial_exits: [sale()] }));
    await expect(updateTrade(db.client, "trade-1", { core: { shares: 30 } })).rejects.toBeInstanceOf(
      PartialExitsError,
    );
  });

  it("refuses moving a trade with sales back to pending", async () => {
    const db = fakeSupabase(openTrade({ partial_exits: [sale()] }));
    await expect(updateTrade(db.client, "trade-1", { core: { status: "pending" } })).rejects.toBeInstanceOf(
      PartialExitsError,
    );
  });

  it("doesn't re-check sales on edits that can't affect them", async () => {
    // Already impossible (the entry was moved after the sale by a path that
    // doesn't check) -- a stop-loss edit must still save.
    const db = fakeSupabase(openTrade({ entry_date: "2026-10-22T00:00:00.000Z", partial_exits: [sale()] }));
    const saved = await updateTrade(db.client, "trade-1", { core: { stop_loss: 48 } });
    expect(saved.stop_loss).toBe(48);
  });
});
