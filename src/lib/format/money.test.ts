import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

/** U+2212, the character formatMoney signs losses with. Spelled out here so a
 *  test failing on a U+002D hyphen says so instead of showing two dashes that
 *  look identical in the diff. */
const MINUS = "−";

describe("formatMoney", () => {
  it("formats a positive amount with separators and two decimals", () => {
    expect(formatMoney(13621.59)).toBe("$13,621.59");
    expect(formatMoney(78622)).toBe("$78,622.00");
    expect(formatMoney(0.5)).toBe("$0.50");
  });

  it("puts the sign before the currency symbol, not after it", () => {
    // The trade table used to render "$-1360.21".
    expect(formatMoney(-1360.21)).toBe(`${MINUS}$1,360.21`);
    expect(formatMoney(-1360.21)).not.toContain("$-");
  });

  it("signs losses with U+2212, never an ASCII hyphen", () => {
    expect(formatMoney(-42)).toBe(`${MINUS}$42.00`);
    expect(formatMoney(-42)).not.toContain("-");
  });

  it("renders zero unsigned", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(-0)).toBe("$0.00");
    expect(formatMoney(0, { sign: "always" })).toBe("$0.00");
  });

  it("does not sign an amount that rounds to zero", () => {
    // "−$0.00" claims a loss the figure does not show.
    expect(formatMoney(-0.004)).toBe("$0.00");
    expect(formatMoney(0.004, { sign: "always" })).toBe("$0.00");
  });

  it("separates thousands past a million", () => {
    expect(formatMoney(1000000)).toBe("$1,000,000.00");
    expect(formatMoney(1234567.891)).toBe("$1,234,567.89");
    expect(formatMoney(-9876543.21)).toBe(`${MINUS}$9,876,543.21`);
  });

  it("rounds half away from zero on the decimal form", () => {
    // Not the same as toFixed(2), which rounds the binary double and gives
    // "1.00" for 1.005. See the note on formatMoney.
    expect(formatMoney(1.005)).toBe("$1.01");
    expect(formatMoney(2.675)).toBe("$2.68");
    expect(formatMoney(-1.005)).toBe(`${MINUS}$1.01`);
    expect(formatMoney(1.004)).toBe("$1.00");
  });

  it('signs gains under sign: "always"', () => {
    expect(formatMoney(8475.82, { sign: "always" })).toBe("+$8,475.82");
    expect(formatMoney(-1360.21, { sign: "always" })).toBe(`${MINUS}$1,360.21`);
    expect(formatMoney(4928.61, { sign: "always" })).toBe("+$4,928.61");
  });

  it("returns the placeholder for a value it cannot show", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatMoney(Number.NEGATIVE_INFINITY)).toBe("—");
    expect(formatMoney(null, { placeholder: "not set" })).toBe("not set");
    expect(formatMoney(null, { placeholder: "n/a" })).toBe("n/a");
  });

  it("abbreviates in compact mode, for chart axes", () => {
    expect(formatMoney(13621.59, { compact: true })).toBe("$13.6K");
    expect(formatMoney(-1360.21, { compact: true })).toBe(`${MINUS}$1.4K`);
    expect(formatMoney(1234567, { compact: true })).toBe("$1.2M");
    expect(formatMoney(999, { compact: true })).toBe("$999");
    expect(formatMoney(0, { compact: true })).toBe("$0");
    expect(formatMoney(null, { compact: true })).toBe("—");
  });

  it("honours a currency override", () => {
    expect(formatMoney(10, { currency: "EUR" })).toBe("€10.00");
    expect(formatMoney(-10, { currency: "EUR" })).toBe(`${MINUS}€10.00`);
    expect(formatMoney(1234.5, { currency: "GBP" })).toBe("£1,234.50");
  });

  it("is stable across repeated calls, since formatters are cached", () => {
    const first = formatMoney(1234.5);
    for (let i = 0; i < 50; i++) expect(formatMoney(1234.5)).toBe(first);
    // A second currency must not be served the first one's formatter.
    expect(formatMoney(1234.5, { currency: "EUR" })).not.toBe(first);
    expect(formatMoney(1234.5)).toBe(first);
  });
});
