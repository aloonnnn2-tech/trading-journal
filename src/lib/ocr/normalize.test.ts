import { describe, expect, it } from "vitest";
import { parseNumber, looksLikeValue, isNumericToken } from "./normalize";

describe("parseNumber", () => {
  it("parses a plain number", () => {
    expect(parseNumber("189.32")).toBe(189.32);
    expect(parseNumber(".50")).toBe(0.5);
  });

  it("strips thousands separators", () => {
    expect(parseNumber("$1,234.56")).toBe(1234.56);
  });

  it("reads parenthesised accounting notation as negative", () => {
    expect(parseNumber("(1,234.50)")).toBe(-1234.5);
  });

  it("reads a leading minus sign as negative", () => {
    expect(parseNumber("-45.20")).toBe(-45.2);
    expect(parseNumber("P/L -45.20")).toBe(-45.2);
  });

  it("doesn't mistake a range's hyphen for a minus sign", () => {
    expect(parseNumber("100 - 150")).toBe(100);
    expect(parseNumber("100-150")).toBe(100);
  });

  it("applies a k/M/B suffix glued to the number", () => {
    expect(parseNumber("1.5k")).toBe(1500);
    expect(parseNumber("Volume 1.5M shares")).toBe(1500000);
    expect(parseNumber("2.3B")).toBe(2300000000);
  });

  it("doesn't treat a unit-like word as a suffix", () => {
    // "kg" isn't "k" -- \b after the multiplier letter must actually be a
    // word boundary, not just any character.
    expect(parseNumber("150kg")).toBe(150);
  });

  // Regression: a negative dollar amount and a negative percentage shown
  // together on one OCR line ("P/L -45.20 -1.20%", no wrapping parens --
  // common on MT4/5-style and some mobile broker layouts). The sign check
  // used to scan the whole string for a range pattern, and "45.20 -1.20"
  // (the extracted number plus the second, unrelated number) satisfied
  // that check, silently dropping the leading "-" that belongs to the
  // number actually being parsed.
  it("keeps the sign when a second, unrelated number follows on the same line", () => {
    expect(parseNumber("-45.20 -1.20%")).toBe(-45.2);
  });

  it("still works when that second number is parenthesised", () => {
    expect(parseNumber("-45.20 (-1.20%)")).toBe(-45.2);
  });

  // Regression: same root cause as above, for the k/M/B suffix -- it was
  // matched anywhere in the string, so a later, unrelated number carrying a
  // suffix multiplied the *first* (unrelated) number instead.
  it("doesn't apply a suffix that belongs to a different number in the string", () => {
    expect(parseNumber("2.50 150k")).toBe(2.5);
  });

  it("returns null for text with no number in it", () => {
    expect(parseNumber("n/a")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("looksLikeValue", () => {
  it("accepts a leading number, with or without a currency symbol", () => {
    expect(looksLikeValue("189.32")).toBe(true);
    expect(looksLikeValue("$189.32")).toBe(true);
  });

  it("rejects text that doesn't lead with a number", () => {
    expect(looksLikeValue("Stop Loss")).toBe(false);
  });
});

describe("isNumericToken", () => {
  it("accepts a clean standalone number, incl. currency/sign/percent decoration", () => {
    expect(isNumericToken("189.32")).toBe(true);
    expect(isNumericToken("-45.20")).toBe(true);
    expect(isNumericToken("$1,234")).toBe(true);
    expect(isNumericToken("12.5%")).toBe(true);
  });

  it("rejects a digit glued inside a word", () => {
    expect(isNumericToken("L0ss")).toBe(false);
  });
});
