import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setTradeFolders } from "./queries";

// Fake covering exactly the calls setTradeFolders makes: a trade-ownership
// lookup, a folder-ownership validation, then a delete + insert on
// trade_folders. `tradeExists` simulates RLS on the `trades` table --
// false is what a trade belonging to another user looks like (RLS filters
// it to nothing, same as a genuinely missing id).
function fakeSupabase(opts: { tradeExists: boolean; validFolderIds: string[] }) {
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
    if (table === "folders") {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => {
            calls.push({ table, op: "select" });
            const matched = ids.filter((id) => opts.validFolderIds.includes(id));
            return Promise.resolve({ data: matched.map((id) => ({ id })), error: null });
          },
        }),
      };
    }
    if (table === "trade_folders") {
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

describe("setTradeFolders", () => {
  it("rejects a trade that isn't the caller's own before touching trade_folders at all", async () => {
    const { client, calls } = fakeSupabase({ tradeExists: false, validFolderIds: ["folder-1"] });

    await expect(setTradeFolders(client, "someone-elses-trade", ["folder-1"])).rejects.toThrow(
      "Trade not found",
    );

    // The whole point of the fix: no write to trade_folders should ever be
    // attempted once the trade check fails.
    expect(calls.some((c) => c.table === "trade_folders")).toBe(false);
  });

  it("succeeds when the trade is the caller's own and every folder is too", async () => {
    const { client } = fakeSupabase({ tradeExists: true, validFolderIds: ["folder-1", "folder-2"] });
    await expect(setTradeFolders(client, "trade-1", ["folder-1", "folder-2"])).resolves.toBeUndefined();
  });

  it("still rejects a folder id that isn't the caller's own", async () => {
    const { client } = fakeSupabase({ tradeExists: true, validFolderIds: ["folder-1"] });
    await expect(setTradeFolders(client, "trade-1", ["folder-1", "not-mine"])).rejects.toThrow(
      "One or more folders were not found",
    );
  });
});
