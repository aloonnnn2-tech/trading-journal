import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setTradeStrategies } from "./queries";

// Same shape as folders/queries.test.ts -- setTradeStrategies has the
// identical trade-ownership-then-strategy-ownership structure.
function fakeSupabase(opts: { tradeExists: boolean; validStrategyIds: string[] }) {
  const calls: { table: string; op: string }[] = [];
  const from = (table: string) => {
    if (table === "trades") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              calls.push({ table, op: "select" });
              return Promise.resolve({
                data: opts.tradeExists ? { id: "trade-1" } : null,
                error: null,
              });
            },
          }),
        }),
      };
    }
    if (table === "strategies") {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => {
            calls.push({ table, op: "select" });
            const matched = ids.filter((id) => opts.validStrategyIds.includes(id));
            return Promise.resolve({ data: matched.map((id) => ({ id })), error: null });
          },
        }),
      };
    }
    if (table === "trade_strategies") {
      return {
        delete: () => ({
          eq: () => {
            calls.push({ table, op: "delete" });
            return Promise.resolve({ error: null });
          },
        }),
        insert: () => {
          calls.push({ table, op: "insert" });
          return Promise.resolve({ error: null });
        },
      };
    }
    throw new Error(`unexpected table: ${table}`);
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("setTradeStrategies", () => {
  it("rejects a trade that isn't the caller's own before touching trade_strategies at all", async () => {
    const { client, calls } = fakeSupabase({ tradeExists: false, validStrategyIds: ["strategy-1"] });

    await expect(
      setTradeStrategies(client, "someone-elses-trade", ["strategy-1"]),
    ).rejects.toThrow("Trade not found");

    expect(calls.some((c) => c.table === "trade_strategies")).toBe(false);
  });

  it("succeeds when the trade is the caller's own and every strategy is too", async () => {
    const { client } = fakeSupabase({
      tradeExists: true,
      validStrategyIds: ["strategy-1", "strategy-2"],
    });
    await expect(
      setTradeStrategies(client, "trade-1", ["strategy-1", "strategy-2"]),
    ).resolves.toBeUndefined();
  });

  it("still rejects a strategy id that isn't the caller's own", async () => {
    const { client } = fakeSupabase({ tradeExists: true, validStrategyIds: ["strategy-1"] });
    await expect(setTradeStrategies(client, "trade-1", ["strategy-1", "not-mine"])).rejects.toThrow(
      "One or more strategies were not found",
    );
  });
});
