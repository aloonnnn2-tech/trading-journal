import { describe, expect, it } from "vitest";
import { countOf, formatMonthKey } from "./count";

describe("countOf", () => {
  it("is singular only for exactly one", () => {
    expect(countOf(0, "trade")).toBe("0 trades");
    expect(countOf(1, "trade")).toBe("1 trade");
    expect(countOf(2, "trade")).toBe("2 trades");
  });
  it("takes an irregular plural", () => {
    expect(countOf(1, "loss", "losses")).toBe("1 loss");
    expect(countOf(3, "loss", "losses")).toBe("3 losses");
  });
});

describe("formatMonthKey", () => {
  it("writes a month the way a person would", () => {
    expect(formatMonthKey("2026-11")).toBe("Nov 2026");
    expect(formatMonthKey("2026-01")).toBe("Jan 2026");
  });
  it("leaves anything that is not a month key alone", () => {
    expect(formatMonthKey("2026-13")).toBe("2026-13");
    expect(formatMonthKey("November")).toBe("November");
  });
});
