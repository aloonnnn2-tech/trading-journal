import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@/lib/fields/types";
import { formatPrice, formatSigned, holdTime, isTradeId, neighbours, panelTextFields } from "./panel";

describe("neighbours", () => {
  const order = ["a", "b", "c"];

  it("gives the trades either side in the list's order", () => {
    expect(neighbours(order, "b")).toEqual({ prev: "a", next: "c", index: 1 });
  });

  it("stops at the first and last trade rather than wrapping", () => {
    expect(neighbours(order, "a")).toEqual({ prev: null, next: "b", index: 0 });
    expect(neighbours(order, "c")).toEqual({ prev: "b", next: null, index: 2 });
  });

  it("has nowhere to go for a trade not in the list (a shared link to another page)", () => {
    expect(neighbours(order, "z")).toEqual({ prev: null, next: null, index: -1 });
  });

  it("handles a one-trade list", () => {
    expect(neighbours(["a"], "a")).toEqual({ prev: null, next: null, index: 0 });
  });
});

describe("holdTime", () => {
  it("formats minutes, hours and days", () => {
    expect(holdTime("2026-08-10T13:30:00Z", "2026-08-10T13:55:00Z")).toBe("25m");
    expect(holdTime("2026-08-10T13:30:00Z", "2026-08-10T16:50:00Z")).toBe("3h 20m");
    expect(holdTime("2026-08-10T13:30:00Z", "2026-08-10T15:30:00Z")).toBe("2h");
    expect(holdTime("2026-08-10T13:30:00Z", "2026-08-14T15:30:00Z")).toBe("4d 2h");
    expect(holdTime("2026-08-10T13:30:00Z", "2026-08-12T13:30:00Z")).toBe("2d");
  });

  it("is null when a date is missing or they run backwards", () => {
    expect(holdTime(null, "2026-08-10T13:30:00Z")).toBeNull();
    expect(holdTime("2026-08-10T13:30:00Z", null)).toBeNull();
    expect(holdTime("2026-08-11T00:00:00Z", "2026-08-10T00:00:00Z")).toBeNull();
  });
});

describe("panelTextFields", () => {
  const def = (key: string, field_type: FieldDefinition["field_type"], label = key) =>
    ({ key, label, field_type }) as FieldDefinition;

  it("keeps text-like fields with a value, in field order", () => {
    const defs = [def("notes", "large_notes", "Notes"), def("setup", "dropdown", "Setup"), def("tags", "multi_select", "Tags")];
    expect(panelTextFields(defs, { notes: "  Waited for the retest. ", setup: "Breakout", tags: ["A+", "", "news"] })).toEqual([
      { key: "notes", label: "Notes", value: "Waited for the retest." },
      { key: "setup", label: "Setup", value: "Breakout" },
      { key: "tags", label: "Tags", value: "A+, news" },
    ]);
  });

  it("drops empty values and non-text field types", () => {
    const defs = [def("notes", "large_notes"), def("confidence", "rating"), def("size", "number"), def("empty", "text")];
    expect(panelTextFields(defs, { notes: "", confidence: 4, size: 10, empty: "   " })).toEqual([]);
  });
});

describe("formatPrice", () => {
  it("keeps sub-cent precision and adds separators", () => {
    expect(formatPrice(192.3)).toBe("192.30");
    expect(formatPrice(64250.5)).toBe("64,250.50");
    expect(formatPrice(0.00001234)).toBe("0.00001234");
  });

  it("shows a dash, not 0, when absent", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(undefined)).toBe("—");
  });
});

describe("formatSigned", () => {
  it("signs gains and losses, with the same minus as formatMoney", () => {
    expect(formatSigned(1.25, "R")).toBe("+1.25R");
    expect(formatSigned(-2.4, "%")).toBe("−2.40%");
  });

  it("leaves zero unsigned and absent values as a dash", () => {
    expect(formatSigned(0, "R")).toBe("0.00R");
    expect(formatSigned(-0.001, "R")).toBe("0.00R");
    expect(formatSigned(null, "R")).toBe("—");
  });
});

describe("isTradeId", () => {
  it("accepts a uuid and nothing else", () => {
    expect(isTradeId("3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b")).toBe(true);
    expect(isTradeId("import")).toBe(false);
    expect(isTradeId("x.png")).toBe(false);
  });
});
