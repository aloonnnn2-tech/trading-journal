import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnalyticsSummary } from "./queries";

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

function closedTradeRow(exitDate: string) {
  return {
    status: "closed",
    mode: "trade",
    entry_date: "2026-01-01T00:00:00.000Z",
    exit_date: exitDate,
    dollar_pl: 100,
    r_multiple: 1,
    direction: "long",
    result: "win",
    position_size: 1000,
    trade_strategies: [],
  };
}

describe("getAnalyticsSummary monthly bucketing", () => {
  it("buckets by the trader's local calendar month, not UTC's", async () => {
    // 2026-02-01T02:00:00Z is Jan 31st, 9pm in America/New_York (UTC-5) --
    // UTC says February, local time says January. Slicing the raw ISO
    // string (the bug) would put this trade in "2026-02"; bucketing by the
    // local day (the fix) correctly puts it in "2026-01".
    const supabase = fakeSupabase([closedTradeRow("2026-02-01T02:00:00.000Z")]);

    const summaryUtc = await getAnalyticsSummary(supabase, null);
    expect(summaryUtc.byMonth).toEqual([{ month: "2026-02", totalPL: 100 }]);

    const summaryLocal = await getAnalyticsSummary(supabase, "America/New_York");
    expect(summaryLocal.byMonth).toEqual([{ month: "2026-01", totalPL: 100 }]);
  });

  it("agrees with the dashboard's own local-day logic for the same trade and timezone", async () => {
    // Same instant, same timezone, cross-checked directly against
    // local-day.ts (which the dashboard uses) rather than a hardcoded
    // string -- if that helper's behavior ever changes, this test changes
    // with it instead of silently drifting.
    const exitDate = "2026-02-01T02:00:00.000Z";
    const supabase = fakeSupabase([closedTradeRow(exitDate)]);
    const summary = await getAnalyticsSummary(supabase, "America/New_York");

    const { localDateParts } = await import("@/lib/dates/local-day");
    const { year, month } = localDateParts(new Date(exitDate), "America/New_York");
    const expectedMonth = `${year}-${String(month + 1).padStart(2, "0")}`;

    expect(summary.byMonth[0].month).toBe(expectedMonth);
  });
});
