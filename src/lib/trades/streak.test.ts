import { describe, it, expect } from "vitest";
import { computeAttentionStreak, type StreakTrade } from "./streak";

const TZ = "UTC";
const iso = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h)).toISOString();

function complete(id: string, createdAt: string): StreakTrade {
  return {
    id,
    mode: "trade",
    status: "closed",
    created_at: createdAt,
    ticker: "AAPL",
    direction: "long",
    entry_price: 1,
    exit_price: 2,
    stop_loss: 0.5,
    entry_date: createdAt,
    exit_date: createdAt,
    dollar_amount: null,
    shares: 10,
    position_size: null,
  };
}

function incomplete(id: string, createdAt: string): StreakTrade {
  return { ...complete(id, createdAt), direction: null, entry_price: null, stop_loss: null, exit_date: null };
}

function investment(id: string, createdAt: string): StreakTrade {
  return {
    ...complete(id, createdAt),
    mode: "investment",
    status: "open",
    direction: null,
    entry_price: null,
    stop_loss: null,
    exit_date: null,
    shares: null,
  };
}

describe("computeAttentionStreak", () => {
  it("is zero with no history", () => {
    expect(computeAttentionStreak([], [], TZ, new Date(iso(2026, 7, 28)))).toBe(0);
  });

  it("counts today once it has a fully filled trade", () => {
    expect(computeAttentionStreak([complete("a", iso(2026, 7, 28))], [], TZ, new Date(iso(2026, 7, 28, 15)))).toBe(1);
  });

  // A streak shouldn't read as broken first thing in the morning just
  // because the user hasn't logged anything yet today.
  it("counts back from yesterday when today is still in progress", () => {
    const trades = [complete("a", iso(2026, 7, 26)), complete("b", iso(2026, 7, 27))];
    expect(computeAttentionStreak(trades, [], TZ, new Date(iso(2026, 7, 28, 9)))).toBe(2);
  });

  it("breaks on a day with no trades", () => {
    const trades = [complete("a", iso(2026, 7, 24)), complete("b", iso(2026, 7, 27)), complete("c", iso(2026, 7, 28))];
    expect(computeAttentionStreak(trades, [], TZ, new Date(iso(2026, 7, 28, 15)))).toBe(2);
  });

  it("counts a day where at least one trade is complete", () => {
    const trades = [incomplete("a", iso(2026, 7, 28)), complete("b", iso(2026, 7, 28))];
    expect(computeAttentionStreak(trades, [], TZ, new Date(iso(2026, 7, 28, 15)))).toBe(1);
  });

  it("does not count a day where every trade is incomplete", () => {
    expect(computeAttentionStreak([incomplete("a", iso(2026, 7, 20))], [], TZ, new Date(iso(2026, 7, 28, 15)))).toBe(0);
    expect(computeAttentionStreak([incomplete("a", iso(2026, 7, 27))], [], TZ, new Date(iso(2026, 7, 27, 15)))).toBe(0);
  });

  it("counts an investment trade against its own (shorter) required fields", () => {
    expect(computeAttentionStreak([investment("a", iso(2026, 7, 28))], [], TZ, new Date(iso(2026, 7, 28, 15)))).toBe(1);
  });

  it("spans a month boundary", () => {
    const trades: StreakTrade[] = [];
    for (let d = 25; d <= 31; d++) trades.push(complete(`jul-${d}`, iso(2026, 7, d)));
    for (let d = 1; d <= 3; d++) trades.push(complete(`aug-${d}`, iso(2026, 8, d)));
    expect(computeAttentionStreak(trades, [], TZ, new Date(iso(2026, 8, 3, 15)))).toBe(10);
  });

  it("buckets by the user's calendar day, not UTC's", () => {
    // 00:30 UTC on the 2nd is still the evening of the 1st in New York.
    const trades = [complete("a", "2026-07-02T00:30:00Z")];
    const asOf = new Date("2026-07-02T02:00:00Z");
    expect(computeAttentionStreak(trades, [], "America/New_York", asOf)).toBe(1);
  });
});
