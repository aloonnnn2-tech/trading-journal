import { describe, expect, it } from "vitest";
import { heardFromLabel, isHeardFromAnswer, shouldAskHeardFrom, summarizeHeardFrom, tallyHeardFrom } from "./heard-from";

describe("heard-from", () => {
  it("offers exactly the five answers Alon asked for", async () => {
    const { HEARD_FROM_OPTIONS } = await import("./heard-from");
    expect(HEARD_FROM_OPTIONS.map((o) => o.label)).toEqual(["YouTube", "Instagram", "TikTok", "Google search", "Other"]);
  });

  it("accepts the options and a skip, nothing else", () => {
    expect(isHeardFromAnswer("tiktok")).toBe(true);
    expect(isHeardFromAnswer("skipped")).toBe(true);
    expect(isHeardFromAnswer("TikTok")).toBe(false);
    expect(isHeardFromAnswer("reddit")).toBe(false);
    expect(isHeardFromAnswer(undefined)).toBe(false);
  });

  it("asks only a new account with no answer on record", () => {
    expect(shouldAskHeardFrom(false, {})).toBe(true);
    expect(shouldAskHeardFrom(false, null)).toBe(true);
    expect(shouldAskHeardFrom(false, { heard_from: "youtube" })).toBe(false);
    expect(shouldAskHeardFrom(false, { heard_from: "skipped" })).toBe(false);
    // Existing accounts are past the first-run flow: never asked.
    expect(shouldAskHeardFrom(true, {})).toBe(false);
  });

  it("labels and tallies for the admin page", () => {
    expect(heardFromLabel("google")).toBe("Google search");
    expect(heardFromLabel(undefined)).toBeNull();
    expect(tallyHeardFrom(["tiktok", "youtube", "tiktok", undefined, "skipped"])).toEqual([
      { label: "TikTok", count: 2 },
      { label: "YouTube", count: 1 },
      { label: "Skipped", count: 1 },
    ]);
  });
});

describe("summarizeHeardFrom (admin Analytics)", () => {
  it("counts every channel, shares of those who answered, skips and the never-asked apart", () => {
    const s = summarizeHeardFrom([
      { answer: "tiktok", signupSource: "tiktok" },
      { answer: "tiktok", signupSource: null },
      { answer: "youtube", signupSource: "t.co" },
      { answer: "skipped", signupSource: "tiktok" },
      { answer: undefined, signupSource: null },
    ]);
    expect(s.answered).toBe(3);
    expect(s.skipped).toBe(1);
    expect(s.notAsked).toBe(1);
    expect(s.channels).toEqual([
      { label: "TikTok", count: 2, pct: 67 },
      { label: "YouTube", count: 1, pct: 33 },
      { label: "Instagram", count: 0, pct: 0 },
      { label: "Google search", count: 0, pct: 0 },
      { label: "Other", count: 0, pct: 0 },
    ]);
    expect(s.signupLinks).toEqual([
      { source: "tiktok", count: 2 },
      { source: "t.co", count: 1 },
    ]);
  });

  it("is all zeros with nobody to count", () => {
    const s = summarizeHeardFrom([]);
    expect(s.answered).toBe(0);
    expect(s.channels.every((c) => c.count === 0 && c.pct === 0)).toBe(true);
  });
});
