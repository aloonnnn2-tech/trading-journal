import { describe, expect, it } from "vitest";
import { fieldDefinitionCreateSchema, fieldDefinitionPatchSchema, fieldKeyFromLabel } from "./definition-schema";

describe("fieldDefinitionPatchSchema", () => {
  // The regression: the Fields page sends options as { choices: [...] }, and
  // the hand-written check before this demanded a bare array, so every edit
  // was refused with "Invalid options".
  it("accepts exactly what the field manager sends", () => {
    expect(
      fieldDefinitionPatchSchema.safeParse({ label: "Setup", field_type: "dropdown", options: { choices: ["A", "B"] } })
        .success,
    ).toBe(true);
    expect(fieldDefinitionPatchSchema.safeParse({ label: "Notes", field_type: "text", options: {} }).success).toBe(true);
    expect(fieldDefinitionPatchSchema.safeParse({ sort_order: 3 }).success).toBe(true);
  });

  it("refuses the old bare-array shape, unknown keys, an empty change and junk", () => {
    expect(fieldDefinitionPatchSchema.safeParse({ options: ["A", "B"] }).success).toBe(false);
    expect(fieldDefinitionPatchSchema.safeParse({ label: "x", user_id: "someone" }).success).toBe(false);
    expect(fieldDefinitionPatchSchema.safeParse({}).success).toBe(false);
    expect(fieldDefinitionPatchSchema.safeParse(["label"]).success).toBe(false);
    expect(fieldDefinitionPatchSchema.safeParse({ label: "   " }).success).toBe(false);
    expect(fieldDefinitionPatchSchema.safeParse({ sort_order: 1.5 }).success).toBe(false);
  });

  it("bounds sizes", () => {
    expect(fieldDefinitionPatchSchema.safeParse({ label: "x".repeat(81) }).success).toBe(false);
    const tooMany = Array.from({ length: 101 }, (_, i) => `c${i}`);
    expect(fieldDefinitionPatchSchema.safeParse({ options: { choices: tooMany } }).success).toBe(false);
  });
});

describe("fieldDefinitionCreateSchema", () => {
  it("fills the same defaults the route used to", () => {
    const parsed = fieldDefinitionCreateSchema.parse({ label: "Setup quality", field_type: "rating" });
    expect(parsed).toEqual({
      label: "Setup quality",
      field_type: "rating",
      entity_type: "trade",
      options: {},
      sort_order: 200,
      strategy_id: null,
    });
  });

  it("refuses an unknown type or a non-uuid strategy", () => {
    expect(fieldDefinitionCreateSchema.safeParse({ label: "x", field_type: "script" }).success).toBe(false);
    expect(fieldDefinitionCreateSchema.safeParse({ label: "x", field_type: "text", strategy_id: "1" }).success).toBe(false);
  });
});

describe("fieldKeyFromLabel", () => {
  it("makes a stable snake_case key", () => {
    expect(fieldKeyFromLabel("  Setup Quality (1-5) ")).toBe("setup_quality_1_5");
    expect(fieldKeyFromLabel("!!!")).toBe("");
  });
});
