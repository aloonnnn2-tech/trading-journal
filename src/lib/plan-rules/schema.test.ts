import { describe, expect, it } from "vitest";
import { ruleCreateSchema, rulePatchSchema } from "./schema";

// A rule saved without the operands its operator needs can never be evaluated
// -- it would sit on the trade card forever reporting "this rule has no value
// to compare against". This schema is what stops one being created; the
// evaluator's unevaluable path is what stops one breaking the page if it
// somehow exists anyway. Both halves are deliberate.

const VALID = {
  strategy_id: "11111111-1111-4111-8111-111111111111",
  label: "Risk under 1%",
  subject_source: "core" as const,
  subject_key: "risk_percent",
  operator: "lte" as const,
  number_value: 1,
  number_value_max: null,
  text_value: null,
};

describe("ruleCreateSchema", () => {
  it("accepts a well-formed numeric rule", () => {
    expect(ruleCreateSchema.safeParse(VALID).success).toBe(true);
  });

  it("requires a number for a numeric comparison", () => {
    const result = ruleCreateSchema.safeParse({ ...VALID, number_value: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Enter the value to compare against.");
    }
  });

  it("requires an upper bound for between", () => {
    const result = ruleCreateSchema.safeParse({
      ...VALID,
      operator: "between",
      number_value: 3,
      number_value_max: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["number_value_max"]);
  });

  it("accepts between when both ends are given", () => {
    expect(
      ruleCreateSchema.safeParse({
        ...VALID,
        subject_source: "derived",
        subject_key: "holding_days",
        operator: "between",
        number_value: 3,
        number_value_max: 7,
      }).success,
    ).toBe(true);
  });

  it("requires text for a text comparison, and rejects whitespace-only", () => {
    for (const text_value of [null, "   "]) {
      const result = ruleCreateSchema.safeParse({
        ...VALID,
        subject_key: "direction",
        operator: "text_eq",
        number_value: null,
        text_value,
      });
      expect(result.success).toBe(false);
    }
  });

  it("needs no operand for a presence or boolean check", () => {
    for (const operator of ["is_set", "is_not_set", "is_true", "is_false"] as const) {
      expect(
        ruleCreateSchema.safeParse({ ...VALID, operator, number_value: null }).success,
      ).toBe(true);
    }
  });

  it("rejects NaN and Infinity before they reach a numeric column", () => {
    expect(ruleCreateSchema.safeParse({ ...VALID, number_value: Number.NaN }).success).toBe(false);
    expect(
      ruleCreateSchema.safeParse({ ...VALID, number_value: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
  });

  it("rejects an unknown operator or subject source", () => {
    expect(ruleCreateSchema.safeParse({ ...VALID, operator: "matches" }).success).toBe(false);
    expect(ruleCreateSchema.safeParse({ ...VALID, subject_source: "sql" }).success).toBe(false);
  });

  it("bounds the label and the subject key", () => {
    expect(ruleCreateSchema.safeParse({ ...VALID, label: "" }).success).toBe(false);
    expect(ruleCreateSchema.safeParse({ ...VALID, label: "x".repeat(101) }).success).toBe(false);
    expect(ruleCreateSchema.safeParse({ ...VALID, subject_key: "x".repeat(81) }).success).toBe(
      false,
    );
  });

  it("requires a strategy to attach the rule to", () => {
    expect(ruleCreateSchema.safeParse({ ...VALID, strategy_id: "not-a-uuid" }).success).toBe(false);
  });
});

describe("rulePatchSchema", () => {
  it("takes the whole definition, not a partial", () => {
    // A partial patch can't be validated: switching the operator to `between`
    // alone would need a stored upper bound this schema cannot see.
    const { strategy_id: _ignored, ...whole } = VALID;
    expect(rulePatchSchema.safeParse(whole).success).toBe(true);
    expect(rulePatchSchema.safeParse({ enabled: false }).success).toBe(false);
  });

  it("ignores a strategy_id, so a patch cannot move a rule between strategies", () => {
    const result = rulePatchSchema.safeParse({
      ...VALID,
      strategy_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("strategy_id");
    }
  });
});
