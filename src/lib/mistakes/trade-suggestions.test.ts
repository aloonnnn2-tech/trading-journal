import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trade } from "@/lib/trades/types";
import { DETECTED_LABELS } from "./analyze";
import { getTradeSuggestions } from "./trade-suggestions";

// The one property this feature lives or dies on: **computing a suggestion
// never writes to the journal.** The stub below has no write methods at all,
// so any attempt to insert, update or upsert fails the test by throwing rather
// than by an assertion someone could forget to make.

/** A Supabase double that can only read `trades.risk_percent`. */
function readOnlyClient(risks: (number | null)[]): SupabaseClient {
  const rows = risks.map((risk_percent) => ({ risk_percent }));
  const builder = {
    select: () => builder,
    eq: () => builder,
    not: () => builder,
    neq: () => builder,
    range: (from: number) =>
      // fetchAllRows pages until it sees a short page; one page is enough here.
      Promise.resolve({ data: from === 0 ? rows : [], error: null }),
  };
  return {
    from: (table: string) => {
      if (table !== "trades") throw new Error(`unexpected table ${table}`);
      return builder;
    },
  } as unknown as SupabaseClient;
}

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: "t-1",
    status: "closed",
    mode: "trade",
    ticker: "NVDA",
    direction: "long",
    entry_price: 100,
    exit_price: 110,
    stop_loss: 95,
    take_profit: 130,
    exit_date: "2026-08-14T19:00:00Z",
    dollar_pl: 500,
    r_multiple: 2,
    risk_percent: 1,
    custom_fields: {},
    ...over,
  } as unknown as Trade;
}

// Five trades at 1% is enough to establish a median (MIN_COMPARISON_SAMPLE).
const NORMAL_RISK = [1, 1, 1, 1, 1];

describe("getTradeSuggestions", () => {
  it("offers a moved stop when the history says it moved", async () => {
    const result = await getTradeSuggestions(readOnlyClient(NORMAL_RISK), trade(), {
      stopMoved: true,
      targetMoved: false,
    });
    expect(result.map((s) => s.label)).toContain(DETECTED_LABELS.movedStop);
  });

  it("offers an early exit on a winner that closed short of its target", async () => {
    const result = await getTradeSuggestions(readOnlyClient(NORMAL_RISK), trade(), null);
    expect(result.map((s) => s.label)).toEqual([DETECTED_LABELS.exitedEarly]);
  });

  it("offers oversized against the trader's own median, not an absolute", async () => {
    // 1.6% is oversized next to a 1% median and ordinary next to a 2% one.
    const big = trade({ risk_percent: 1.6, exit_price: 130 });
    const againstOnePercent = await getTradeSuggestions(readOnlyClient(NORMAL_RISK), big, null);
    const againstTwoPercent = await getTradeSuggestions(readOnlyClient([2, 2, 2, 2, 2]), big, null);

    expect(againstOnePercent.map((s) => s.label)).toContain(DETECTED_LABELS.oversized);
    expect(againstTwoPercent.map((s) => s.label)).not.toContain(DETECTED_LABELS.oversized);
  });

  it("stops offering a label already on the Mistakes field", async () => {
    const result = await getTradeSuggestions(
      readOnlyClient(NORMAL_RISK),
      trade({ custom_fields: { trade_mistakes: [DETECTED_LABELS.exitedEarly] } }),
      null,
    );
    expect(result).toEqual([]);
  });

  it("stops offering a label the trader dismissed", async () => {
    const result = await getTradeSuggestions(
      readOnlyClient(NORMAL_RISK),
      trade({ dismissed_suggestions: [DETECTED_LABELS.exitedEarly] } as Partial<Trade>),
      null,
    );
    expect(result).toEqual([]);
  });

  it("treats an absent dismissal column as none dismissed", async () => {
    // Migration 0037 is applied by hand, so there is a window where the column
    // does not exist. That must read as "nothing dismissed", not as a crash.
    const result = await getTradeSuggestions(readOnlyClient(NORMAL_RISK), trade(), null);
    expect(result).toHaveLength(1);
  });

  it("offers nothing on an open trade", async () => {
    // Exit management has not happened yet; judging it would be inventing it.
    const result = await getTradeSuggestions(
      readOnlyClient(NORMAL_RISK),
      trade({ status: "open" }),
      { stopMoved: true, targetMoved: true },
    );
    expect(result).toEqual([]);
  });

  it("offers nothing on an investment-mode position", async () => {
    const result = await getTradeSuggestions(
      readOnlyClient(NORMAL_RISK),
      trade({ mode: "investment" }),
      { stopMoved: true, targetMoved: true },
    );
    expect(result).toEqual([]);
  });

  it("says nothing about a stop when there is no edit history", async () => {
    // Null is "unknown", not "unchanged" -- a trade with no snapshots must not
    // be accused of moving anything.
    const result = await getTradeSuggestions(readOnlyClient(NORMAL_RISK), trade(), null);
    expect(result.map((s) => s.label)).not.toContain(DETECTED_LABELS.movedStop);
  });

  it("withholds oversized until there are enough trades to have a median", async () => {
    // Below the sample floor there is no normal to be oversized against, and
    // guessing one would flag ordinary trades on a brand-new journal.
    const result = await getTradeSuggestions(
      readOnlyClient([1, 1]),
      trade({ risk_percent: 9, exit_price: 130 }),
      null,
    );
    expect(result.map((s) => s.label)).not.toContain(DETECTED_LABELS.oversized);
  });
});
