import { describe, expect, it } from "vitest";
import {
  periodReviewContentSchema,
  periodReviewSchema,
  tradeReviewContentSchema,
  tradeReviewSchema,
} from "./schema";

// The contract between "what a model felt like returning" and "what the card
// is allowed to render". Every normalisation below exists because rejecting
// the reply instead would cost a second provider call on the user's own quota
// for something cosmetic.

const MINIMAL = { overall_assessment: "Solid entry, early exit.", score: 60 };

describe("tradeReviewSchema (request)", () => {
  it("rejects a non-uuid trade id with a usable message", () => {
    const result = tradeReviewSchema.safeParse({ tradeId: "nope", keyId: crypto.randomUUID() });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Pick a trade to review.");
  });
});

describe("tradeReviewContentSchema", () => {
  it("accepts a reply carrying only the headline", () => {
    const parsed = tradeReviewContentSchema.parse(MINIMAL);
    // Absent sections become empty lists, so the renderer never has to check
    // for undefined.
    expect(parsed.what_went_well).toEqual([]);
    expect(parsed.rule_adherence).toEqual([]);
    expect(parsed.action_items).toEqual([]);
    expect(parsed.score_breakdown).toEqual({});
    expect(parsed.biggest_mistake).toBe("");
  });

  it("rejects a reply with no assessment", () => {
    expect(tradeReviewContentSchema.safeParse({ score: 60 }).success).toBe(false);
  });

  it("rejects a reply with no score", () => {
    expect(
      tradeReviewContentSchema.safeParse({ overall_assessment: "Fine." }).success,
    ).toBe(false);
  });

  it("clamps an out-of-range score rather than failing", () => {
    expect(tradeReviewContentSchema.parse({ ...MINIMAL, score: 105 }).score).toBe(100);
    expect(tradeReviewContentSchema.parse({ ...MINIMAL, score: -20 }).score).toBe(0);
  });

  it("accepts a score sent as a string, and rounds a fractional one", () => {
    expect(tradeReviewContentSchema.parse({ ...MINIMAL, score: "82" }).score).toBe(82);
    expect(tradeReviewContentSchema.parse({ ...MINIMAL, score: 82.6 }).score).toBe(83);
  });

  it("rejects a score that is not a number at all", () => {
    expect(tradeReviewContentSchema.safeParse({ ...MINIMAL, score: "great" }).success).toBe(false);
  });

  it("keeps a declined sub-score as null instead of inventing a number", () => {
    // The important half of "never invent missing information": a trade with
    // no emotion logged gives the model nothing to score discipline on.
    const parsed = tradeReviewContentSchema.parse({
      ...MINIMAL,
      score_breakdown: { setup_quality: 70, emotional_discipline: null },
    });
    expect(parsed.score_breakdown.setup_quality).toBe(70);
    expect(parsed.score_breakdown.emotional_discipline).toBeNull();
  });

  it("normalises whatever the model called a rule status", () => {
    const parsed = tradeReviewContentSchema.parse({
      ...MINIMAL,
      rule_adherence: [
        { rule: "Risk under 1%", status: "Followed" },
        { rule: "Stop before entry", status: "partially followed" },
        { rule: "No revenge trades", status: "NOT_FOLLOWED" },
        { rule: "Wait for volume", status: "who knows" },
        { rule: "Trend filter", status: undefined },
      ],
    });
    expect(parsed.rule_adherence.map((r) => r.status)).toEqual([
      "followed",
      "partially_followed",
      "not_followed",
      // Unrecognised and missing both fall to "unknown" -- understating what
      // the model said, rather than guessing a verdict on the user's trade.
      "unknown",
      "unknown",
    ]);
  });

  it("drops a rule entry with no rule name", () => {
    const parsed = tradeReviewContentSchema.parse({
      ...MINIMAL,
      rule_adherence: [{ status: "followed", note: "n" }, { rule: "Real rule", status: "followed" }],
    });
    expect(parsed.rule_adherence).toHaveLength(1);
  });

  it("drops non-string and blank findings", () => {
    const parsed = tradeReviewContentSchema.parse({
      ...MINIMAL,
      what_went_well: ["Risk was controlled", "", null, 42, "  "],
    });
    expect(parsed.what_went_well).toEqual(["Risk was controlled"]);
  });

  it("bounds a runaway model", () => {
    const parsed = tradeReviewContentSchema.parse({
      ...MINIMAL,
      what_could_improve: Array.from({ length: 40 }, (_, i) => `finding ${i}`),
      biggest_mistake: "x".repeat(5_000),
    });
    expect(parsed.what_could_improve).toHaveLength(10);
    expect(parsed.biggest_mistake).toHaveLength(800);
  });

  it("keeps every action item the model returned", () => {
    // Trimming to three is a presentation decision made by the card, not a
    // reason to reject an otherwise good review and pay for a second call.
    const parsed = tradeReviewContentSchema.parse({
      ...MINIMAL,
      action_items: ["a", "b", "c", "d", "e"],
    });
    expect(parsed.action_items).toHaveLength(5);
  });
});

describe("periodReviewSchema (request)", () => {
  it("accepts a weekly request with no dates", () => {
    // Weekly and monthly resolve their own window server-side, so a client
    // that sends no dates is normal -- and one that sends them cannot widen
    // a "weekly" review into a year.
    const result = periodReviewSchema.safeParse({ keyId: crypto.randomUUID(), kind: "weekly" });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown period type", () => {
    expect(
      periodReviewSchema.safeParse({ keyId: crypto.randomUUID(), kind: "yearly" }).success,
    ).toBe(false);
  });

  it("rejects a date that isn't a calendar day", () => {
    expect(
      periodReviewSchema.safeParse({
        keyId: crypto.randomUUID(),
        kind: "custom",
        startDate: "01/07/2026",
        endDate: "2026-07-15",
      }).success,
    ).toBe(false);
  });
});

describe("periodReviewContentSchema", () => {
  const MINIMAL_PERIOD = { performance_summary: "Nine trades, up 3.2R." };

  it("accepts a reply carrying only the summary", () => {
    const parsed = periodReviewContentSchema.parse(MINIMAL_PERIOD);
    expect(parsed.what_went_well).toEqual([]);
    expect(parsed.strategy_breakdown).toEqual([]);
    expect(parsed.period_comparison).toBe("");
    // A missing edge is not an edge with an empty name -- it defaults to the
    // most cautious reading available.
    expect(parsed.biggest_edge).toEqual({
      finding: "",
      evidence: "",
      confidence: "insufficient_data",
    });
  });

  it("rejects a reply with no summary", () => {
    expect(periodReviewContentSchema.safeParse({}).success).toBe(false);
  });

  it("normalises confidence wording", () => {
    const parsed = periodReviewContentSchema.parse({
      ...MINIMAL_PERIOD,
      biggest_edge: { finding: "Breakouts", evidence: "n=7, 71%", confidence: "High" },
      biggest_leak: { finding: "Chasing", evidence: "n=5", confidence: "moderate" },
      behavioral_patterns: [{ pattern: "Cutting winners", evidence: "6 of 9", confidence: "LOW" }],
    });
    expect(parsed.biggest_edge.confidence).toBe("high");
    expect(parsed.biggest_leak.confidence).toBe("medium");
    expect(parsed.behavioral_patterns[0].confidence).toBe("low");
  });

  it("treats an unrecognised confidence as insufficient data, not as a claim", () => {
    // Understating a finding is recoverable. Overstating one is what puts a
    // trader's money behind four trades of noise.
    const parsed = periodReviewContentSchema.parse({
      ...MINIMAL_PERIOD,
      biggest_edge: { finding: "Something", evidence: "", confidence: "very sure" },
    });
    expect(parsed.biggest_edge.confidence).toBe("insufficient_data");
  });

  it("drops a pattern with no name and a strategy row with no strategy", () => {
    const parsed = periodReviewContentSchema.parse({
      ...MINIMAL_PERIOD,
      behavioral_patterns: [{ evidence: "orphaned" }, { pattern: "Real", confidence: "low" }],
      strategy_breakdown: [{ verdict: "orphaned" }, { strategy: "Breakout", verdict: "good" }],
    });
    expect(parsed.behavioral_patterns).toHaveLength(1);
    expect(parsed.strategy_breakdown).toHaveLength(1);
  });

  it("bounds a runaway model", () => {
    const parsed = periodReviewContentSchema.parse({
      ...MINIMAL_PERIOD,
      behavioral_patterns: Array.from({ length: 30 }, (_, i) => ({
        pattern: `p${i}`,
        confidence: "low",
      })),
      risk_review: Array.from({ length: 30 }, (_, i) => `r${i}`),
    });
    expect(parsed.behavioral_patterns).toHaveLength(8);
    expect(parsed.risk_review).toHaveLength(10);
  });
});
