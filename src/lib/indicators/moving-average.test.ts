import { describe, expect, it } from "vitest";
import { ema, movingAverageName, sma } from "./moving-average";

describe("sma", () => {
  it("averages the last N closes, null until there are N", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("handles a period of 1 and a period longer than the data", () => {
    expect(sma([5, 7], 1)).toEqual([5, 7]);
    expect(sma([5, 7], 3)).toEqual([null, null]);
  });
  it("refuses a nonsense period", () => {
    expect(sma([1, 2, 3], 0)).toEqual([null, null, null]);
    expect(sma([1, 2, 3], 1.5)).toEqual([null, null, null]);
  });
});

describe("ema", () => {
  it("seeds with the SMA, then weights 2/(N+1)", () => {
    // N=3, k=0.5. Seed: (1+2+3)/3 = 2. Then 4*0.5+2*0.5 = 3; 5*0.5+3*0.5 = 4; 10*0.5+4*0.5 = 7.
    expect(ema([1, 2, 3, 4, 5, 10], 3)).toEqual([null, null, 2, 3, 4, 7]);
  });
  it("is all null with too little data", () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });
});

describe("movingAverageName", () => {
  it("reads like a chart label", () => {
    expect(movingAverageName("sma", 150)).toBe("SMA 150");
    expect(movingAverageName("ema", 21)).toBe("EMA 21");
  });
});
