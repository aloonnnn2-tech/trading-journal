import { describe, expect, it } from "vitest";
import { parseDemoState, shouldOfferDemo } from "./state";

describe("shouldOfferDemo", () => {
  const firstLogin = { demoState: null, hasTrades: false, hasCompletedTour: false } as const;

  it("asks on a genuine first login", () => {
    expect(shouldOfferDemo(firstLogin)).toBe(true);
  });

  it("never asks again once answered, either way", () => {
    for (const demoState of ["declined", "active", "done"] as const) {
      expect(shouldOfferDemo({ ...firstLogin, demoState })).toBe(false);
    }
  });

  it("doesn't ask over a journal the user already started, or after the first tour", () => {
    expect(shouldOfferDemo({ ...firstLogin, hasTrades: true })).toBe(false);
    expect(shouldOfferDemo({ ...firstLogin, hasCompletedTour: true })).toBe(false);
  });

  it("doesn't ask while migration 0051 isn't applied", () => {
    expect(shouldOfferDemo({ ...firstLogin, demoState: "unavailable" })).toBe(false);
  });
});

describe("parseDemoState", () => {
  it("keeps the three known states and reads anything else as not asked", () => {
    expect(parseDemoState("active")).toBe("active");
    expect(parseDemoState("declined")).toBe("declined");
    expect(parseDemoState("done")).toBe("done");
    expect(parseDemoState(null)).toBeNull();
    expect(parseDemoState("weird")).toBeNull();
  });
});
