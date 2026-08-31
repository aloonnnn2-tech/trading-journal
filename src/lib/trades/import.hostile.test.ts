import { describe, expect, it } from "vitest";
import { buildRowFromMapping, deriveStatusAndResult } from "./import";

// deriveStatusAndResult exists to keep a self-contradicting status/result pair
// out of the table. It derived the pair correctly, but honoured BOTH values
// verbatim when they were mapped from the source file -- and each passes enum
// validation on its own, so "closed" + "open" got written anyway.

describe("deriveStatusAndResult rejects a contradictory explicit pair", () => {
  it("does not write closed/open, the exact pair it exists to prevent", () => {
    const out = deriveStatusAndResult(
      { status: "closed", result: "open" },
      { dollar_pl: 250 },
    );
    expect(out.status).toBe("closed");
    expect(out.result).not.toBe("open");
    expect(out.result).toBe("win");
  });

  it("closes a row with no computable P/L as break-even, not open", () => {
    const out = deriveStatusAndResult({ status: "closed", result: "open" }, { dollar_pl: null });
    expect(out).toEqual({ status: "closed", result: "break_even" });
  });

  // The inverse is just as wrong: a position still open cannot already be a win.
  it("does not let an open row claim a win", () => {
    const out = deriveStatusAndResult({ status: "open", result: "win" }, { dollar_pl: null });
    expect(out).toEqual({ status: "open", result: "open" });
  });

  it("still honours an explicit result that agrees with its status", () => {
    expect(deriveStatusAndResult({ status: "closed", result: "loss" }, { dollar_pl: 10 })).toEqual({
      status: "closed",
      result: "loss",
    });
    expect(deriveStatusAndResult({ status: "open", result: "open" }, {})).toEqual({
      status: "open",
      result: "open",
    });
  });

  it("still derives the pair when neither is supplied", () => {
    expect(deriveStatusAndResult({ exit_price: 110 }, { dollar_pl: 100 })).toEqual({
      status: "closed",
      result: "win",
    });
    expect(deriveStatusAndResult({}, { dollar_pl: null })).toEqual({
      status: "open",
      result: "open",
    });
  });
});

// buildRowFromMapping indexes both the row and the mapping. Measured against
// the real function, five hostile shapes threw a TypeError -- which the import
// route surfaced as a 500 that abandoned the entire import, valid rows and all.
// The route now rejects these with a 400 before reaching here; these pin the
// shapes that were dangerous so a future change re-introducing them is caught.
describe("buildRowFromMapping's dangerous input shapes", () => {
  const call = (row: unknown, mapping: unknown) =>
    buildRowFromMapping(row as never, mapping as never, new Map() as never);

  it.each([
    ["a null row", null, { A: "ticker" }],
    ["a non-string cell value", { A: 123 }, { A: "ticker" }],
    ["an array cell value", { A: ["x"] }, { A: "ticker" }],
    ["a non-string mapping target", { A: "X" }, { A: 42 }],
    ["a null mapping target", { A: "X" }, { A: null }],
  ])("%s throws, so the route must reject it first", (_label, row, mapping) => {
    expect(() => call(row, mapping)).toThrow(TypeError);
  });

  it("handles the well-formed shape the route now guarantees", () => {
    const built = call({ A: "AAPL", B: "100" }, { A: "ticker", B: "entry_price" });
    expect(built.error).toBeNull();
    expect(built.core).toMatchObject({ ticker: "AAPL", entry_price: 100 });
  });
});
