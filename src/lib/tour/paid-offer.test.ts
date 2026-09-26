import { describe, expect, it } from "vitest";
import { SNOOZE_MS, shouldShowPaidOffer, snoozeUntil, type PaidOfferState } from "./paid-offer";

const NOW = Date.parse("2026-09-23T12:00:00.000Z");

/** A paid account that has never answered the offer. */
function state(overrides: Partial<PaidOfferState> = {}): PaidOfferState {
  return {
    isPaid: true,
    dismissed: false,
    snoozedUntil: null,
    seenThisSession: false,
    ...overrides,
  };
}

describe("shouldShowPaidOffer", () => {
  it("shows for a paid account that has never answered", () => {
    expect(shouldShowPaidOffer(state(), NOW)).toBe(true);
  });

  it("never shows for a free account", () => {
    expect(shouldShowPaidOffer(state({ isPaid: false }), NOW)).toBe(false);
    // Not even if every other condition is clear.
    expect(
      shouldShowPaidOffer(state({ isPaid: false, dismissed: false, snoozedUntil: null }), NOW),
    ).toBe(false);
  });

  it("never shows again once dismissed", () => {
    expect(shouldShowPaidOffer(state({ dismissed: true }), NOW)).toBe(false);
    // Dismissal outranks an expired snooze.
    expect(
      shouldShowPaidOffer(
        state({ dismissed: true, snoozedUntil: new Date(NOW - 1000).toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });

  it("stays hidden while snoozed", () => {
    const until = new Date(NOW + SNOOZE_MS).toISOString();
    expect(shouldShowPaidOffer(state({ snoozedUntil: until }), NOW)).toBe(false);
    // One millisecond before expiry is still snoozed.
    expect(shouldShowPaidOffer(state({ snoozedUntil: until }), NOW + SNOOZE_MS - 1)).toBe(false);
  });

  it("comes back the moment the snooze expires", () => {
    const until = new Date(NOW + SNOOZE_MS).toISOString();
    expect(shouldShowPaidOffer(state({ snoozedUntil: until }), NOW + SNOOZE_MS)).toBe(true);
    expect(shouldShowPaidOffer(state({ snoozedUntil: until }), NOW + SNOOZE_MS + 1)).toBe(true);
  });

  it("comes back after a snooze that expired long ago", () => {
    const until = new Date(NOW - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldShowPaidOffer(state({ snoozedUntil: until }), NOW)).toBe(true);
  });

  it("does not show twice in one session", () => {
    expect(shouldShowPaidOffer(state({ seenThisSession: true }), NOW)).toBe(false);
  });

  it("treats an unreadable snooze timestamp as still snoozed", () => {
    // Corrupt localStorage, a half-written value, a schema change. Showing a
    // card the reader may already have declined is the worse mistake of the
    // two, so this fails toward leaving them alone.
    expect(shouldShowPaidOffer(state({ snoozedUntil: "not a date" }), NOW)).toBe(false);
    expect(shouldShowPaidOffer(state({ snoozedUntil: "" }), NOW)).toBe(false);
  });

  it("handles a snooze written by a clock running ahead", () => {
    // A device whose clock is a year fast writes a far-future expiry. It stays
    // hidden, which is the same outcome as any other snooze -- it just lasts
    // longer. Nothing breaks.
    const until = new Date(NOW + 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldShowPaidOffer(state({ snoozedUntil: until }), NOW)).toBe(false);
  });
});

describe("snoozeUntil", () => {
  it("is seven days out", () => {
    expect(snoozeUntil(NOW)).toBe(new Date(NOW + SNOOZE_MS).toISOString());
    expect(Date.parse(snoozeUntil(NOW)) - NOW).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("round-trips through the predicate", () => {
    const until = snoozeUntil(NOW);
    expect(shouldShowPaidOffer(state({ snoozedUntil: until }), NOW)).toBe(false);
    expect(shouldShowPaidOffer(state({ snoozedUntil: until }), NOW + SNOOZE_MS)).toBe(true);
  });
});
