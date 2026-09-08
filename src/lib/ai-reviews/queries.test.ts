import { describe, expect, it } from "vitest";
import { isMissingTableError, isTradeReviewStale } from "./queries";

describe("isTradeReviewStale", () => {
  const generatedAt = "2026-08-12T19:05:00Z";

  it("is not stale when the trade hasn't been touched since", () => {
    expect(
      isTradeReviewStale({ source_updated_at: generatedAt }, { updated_at: generatedAt }),
    ).toBe(false);
  });

  it("is stale once the trade is edited", () => {
    expect(
      isTradeReviewStale(
        { source_updated_at: generatedAt },
        { updated_at: "2026-08-13T09:00:00Z" },
      ),
    ).toBe(true);
  });

  it("is not stale when the trade's timestamp is older", () => {
    // Shouldn't happen -- generating never writes to the trade -- but a clock
    // skew or a restored version must not flag every review forever.
    expect(
      isTradeReviewStale(
        { source_updated_at: generatedAt },
        { updated_at: "2026-08-01T09:00:00Z" },
      ),
    ).toBe(false);
  });

  it("is not stale when there is nothing to compare against", () => {
    // An unknown answer is better shown as "not stale" than as a warning the
    // user can neither confirm nor clear.
    expect(isTradeReviewStale({ source_updated_at: null }, { updated_at: generatedAt })).toBe(
      false,
    );
    expect(
      isTradeReviewStale({ source_updated_at: "not a date" }, { updated_at: generatedAt }),
    ).toBe(false);
  });
});

describe("isMissingTableError", () => {
  // This app applies migrations by hand, so "deployed but not yet migrated" is
  // a real state on every environment -- and the difference between an
  // actionable message and a bare 500 on the trade page.
  it("recognises both the Postgres and PostgREST forms", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
  });

  it("does not swallow other database errors", () => {
    expect(isMissingTableError({ code: "23505" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(new Error("boom"))).toBe(false);
  });
});
