import { describe, expect, it } from "vitest";
import { toTradeSortField } from "./queries";

describe("toTradeSortField", () => {
  it("passes through every valid sort field", () => {
    for (const field of ["created_at", "entry_date", "exit_date", "ticker", "dollar_pl"]) {
      expect(toTradeSortField(field)).toBe(field);
    }
  });

  it("falls back to created_at for a bad or hand-edited value", () => {
    expect(toTradeSortField("nonsense")).toBe("created_at");
    expect(toTradeSortField("'; drop table trades; --")).toBe("created_at");
  });

  it("falls back to created_at for a missing or non-string value", () => {
    expect(toTradeSortField(undefined)).toBe("created_at");
    expect(toTradeSortField(null)).toBe("created_at");
    expect(toTradeSortField(123)).toBe("created_at");
  });
});
