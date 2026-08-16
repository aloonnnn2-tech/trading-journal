import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmotionBreakdown } from "./queries";

// Applies the filter chain getEmotionBreakdown actually calls
// (eq/not/neq/order) against an in-memory row set, so this proves the
// filters are both present and correctly excluding rows -- not just that
// the aggregation math is right given already-filtered input.
function fakeSupabase(rows: Record<string, unknown>[]): SupabaseClient {
  const from = () => {
    let filtered = rows;
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filtered = filtered.filter((r) => r[col] === val);
        return builder;
      },
      not: (col: string, op: string, val: unknown) => {
        if (op === "is" && val === null) {
          filtered = filtered.filter((r) => r[col] !== null && r[col] !== undefined);
        }
        return builder;
      },
      neq: (col: string, val: unknown) => {
        filtered = filtered.filter((r) => r[col] !== val);
        return builder;
      },
      order: () => builder,
      range: (from: number, to: number) =>
        Promise.resolve({ data: filtered.slice(from, to + 1), error: null }),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

describe("getEmotionBreakdown", () => {
  it("excludes a closed trade with no exit_date, matching every sibling stats module", async () => {
    const supabase = fakeSupabase([
      { status: "closed", dollar_pl: 100, exit_date: null, mode: "trade", emotion_before: ["Calm"] },
    ]);
    const result = await getEmotionBreakdown(supabase);
    expect(result).toEqual([]);
  });

  it("excludes investment-mode trades, whose dollar_pl is always null", async () => {
    const supabase = fakeSupabase([
      { status: "closed", dollar_pl: null, exit_date: "2026-01-01", mode: "investment", emotion_before: ["Calm"] },
    ]);
    const result = await getEmotionBreakdown(supabase);
    expect(result).toEqual([]);
  });

  it("still aggregates a normal closed trade-mode row with an exit date", async () => {
    const supabase = fakeSupabase([
      { status: "closed", dollar_pl: 100, exit_date: "2026-01-01", mode: "trade", emotion_before: ["Calm"] },
      { status: "closed", dollar_pl: -50, exit_date: "2026-01-02", mode: "trade", emotion_before: ["Calm"] },
    ]);
    const result = await getEmotionBreakdown(supabase);
    expect(result).toEqual([
      { emotion: "Calm", trades: 2, wins: 1, winRate: 0.5, totalPL: 50 },
    ]);
  });
});
