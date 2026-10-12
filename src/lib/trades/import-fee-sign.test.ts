import { describe, expect, it } from "vitest";
import { importedFeeSign } from "./import";

describe("importedFeeSign", () => {
  it("flips a file that writes fees as negative cash flows (IBKR), keeping rebates as rebates", () => {
    const sign = importedFeeSign([-1.0, -0.35, "-2.5", 0.35]);
    expect(sign).toBe(-1);
    expect(-1.0 * sign).toBe(1); // a fee -> positive commission
    expect(0.35 * sign).toBe(-0.35); // a rebate -> negative commission, raises P/L
  });

  it("leaves a file of positive fees as it is", () => {
    expect(importedFeeSign([1, 2.5, "0.65"])).toBe(1);
  });

  it("ignores blanks, zeros and junk", () => {
    expect(importedFeeSign([null, "", 0, "n/a", undefined])).toBe(1);
  });
});
