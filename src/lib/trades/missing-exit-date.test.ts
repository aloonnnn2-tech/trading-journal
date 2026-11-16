import { describe, expect, it } from "vitest";
import { missingExitDateMessage } from "./missing-exit-date";

describe("missingExitDateMessage", () => {
  it("says nothing when every closed trade has an exit date", () => {
    expect(missingExitDateMessage({ count: 0, firstTradeId: null, firstTicker: null })).toBeNull();
  });

  it("names the trade when there is one", () => {
    expect(missingExitDateMessage({ count: 1, firstTradeId: "t1", firstTicker: "TSLA" })).toBe(
      "TSLA is closed but has no exit date, so it is not in your win rate or charts yet.",
    );
  });

  it("copes with a trade that has no ticker", () => {
    expect(missingExitDateMessage({ count: 1, firstTradeId: "t1", firstTicker: null })).toBe(
      "1 closed trade has no exit date, so it is not in your win rate or charts yet.",
    );
  });

  it("counts them when there are several", () => {
    expect(missingExitDateMessage({ count: 3, firstTradeId: "t1", firstTicker: "TSLA" })).toBe(
      "3 closed trades have no exit date, so they are not in your win rate or charts yet.",
    );
  });
});
