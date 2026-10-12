import { describe, expect, it } from "vitest";
import { isPromptPage, mayAsk, reviewTrigger, snoozeUntil, type PromptFacts } from "./prompt";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const DAY = 86_400_000;
const fresh: PromptFacts = {
  hasReview: false,
  dismissed: false,
  snoozedUntil: null,
  timesAsked: 0,
  closedTrades: 0,
  accountCreatedAt: new Date(NOW - DAY).toISOString(),
  visits: 1,
};

describe("reviewTrigger", () => {
  it("asks after the 5th closed trade, not the 4th", () => {
    expect(reviewTrigger({ ...fresh, closedTrades: 4 }, NOW)).toBeNull();
    expect(reviewTrigger({ ...fresh, closedTrades: 5 }, NOW)).toBe("closed_trades");
  });

  it("asks after two weeks AND five visits, not either alone", () => {
    const old = new Date(NOW - 15 * DAY).toISOString();
    expect(reviewTrigger({ ...fresh, accountCreatedAt: old, visits: 4 }, NOW)).toBeNull();
    expect(reviewTrigger({ ...fresh, visits: 9 }, NOW)).toBeNull();
    expect(reviewTrigger({ ...fresh, accountCreatedAt: old, visits: 5 }, NOW)).toBe("two_weeks");
  });

  it("never asks someone who reviewed, said never, or was asked three times", () => {
    const busy = { ...fresh, closedTrades: 50 };
    expect(reviewTrigger({ ...busy, hasReview: true }, NOW)).toBeNull();
    expect(reviewTrigger({ ...busy, dismissed: true }, NOW)).toBeNull();
    expect(reviewTrigger({ ...busy, timesAsked: 3 }, NOW)).toBeNull();
    expect(reviewTrigger({ ...busy, timesAsked: 2 }, NOW)).toBe("closed_trades");
  });

  it("'Not now' holds for 30 days; an unreadable date leaves people alone", () => {
    const busy = { ...fresh, closedTrades: 50 };
    const until = snoozeUntil(NOW);
    expect(Date.parse(until) - NOW).toBe(30 * DAY);
    expect(reviewTrigger({ ...busy, snoozedUntil: until }, NOW + 29 * DAY)).toBeNull();
    expect(reviewTrigger({ ...busy, snoozedUntil: until }, NOW + 31 * DAY)).toBe("closed_trades");
    expect(mayAsk({ ...busy, snoozedUntil: "soon" }, NOW)).toBe(false);
  });
});

describe("isPromptPage", () => {
  it("overviews and trade pages, never forms or settings", () => {
    expect(isPromptPage("/dashboard")).toBe(true);
    expect(isPromptPage("/trades")).toBe(true);
    expect(isPromptPage("/trades/3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b")).toBe(true);
    expect(isPromptPage("/trades/import")).toBe(false);
    expect(isPromptPage("/settings")).toBe(false);
    expect(isPromptPage("/review")).toBe(false);
  });
});
