import { describe, expect, it } from "vitest";
import { coreFieldsSchema } from "./schema";
import { fieldLabel, firstIssueMessage, readRefusal, refusalBody, refusedFieldNames } from "./save-refusal";

describe("readRefusal", () => {
  it("reads what refusalBody writes", () => {
    expect(readRefusal(refusalBody("You hold 0.5 shares.", ["shares"]))).toEqual({
      message: "You hold 0.5 shares.",
      fields: ["shares"],
    });
  });

  // PATCH /api/trades/[id] also answers 400 when the database write fails.
  // That one must keep retrying, so only the explicit marker counts.
  it("is not fooled by an ordinary error body", () => {
    expect(readRefusal({ error: "Failed to update trade", code: null })).toBeNull();
    expect(readRefusal({ error: "Unauthorized" })).toBeNull();
    expect(readRefusal(null)).toBeNull();
    expect(readRefusal("refused")).toBeNull();
  });

  it("needs a reason to show, and ignores malformed fields", () => {
    expect(readRefusal({ refused: true })).toBeNull();
    expect(readRefusal({ refused: true, message: "  " })).toBeNull();
    expect(readRefusal({ refused: true, message: "No.", fields: ["shares", 3, null] })).toEqual({
      message: "No.",
      fields: ["shares"],
    });
    expect(readRefusal({ refused: true, message: "No.", fields: "shares" })?.fields).toEqual([]);
  });

  it("keeps `error` for older clients, as a string or the validation detail", () => {
    expect(refusalBody("No.").error).toBe("No.");
    expect(refusalBody("No.", [], { fieldErrors: {} }).error).toEqual({ fieldErrors: {} });
  });
});

describe("refusedFieldNames", () => {
  const sent = ["shares", "dollar_amount", "risk_amount"];

  it("names the field the server named, not the amounts worked out from it", () => {
    expect(refusedFieldNames(sent, { message: "", fields: ["shares", "status"] })).toEqual(["shares"]);
  });

  it("names everything set aside when the server named nothing in the request", () => {
    expect(refusedFieldNames(sent, { message: "", fields: [] })).toEqual(sent);
    expect(refusedFieldNames(sent, { message: "", fields: ["status"] })).toEqual(sent);
  });
});

describe("firstIssueMessage", () => {
  it("names the field and the reason from a validation failure", () => {
    const parsed = coreFieldsSchema.safeParse({ stop_loss: Number.MAX_SAFE_INTEGER * 4 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstIssueMessage(parsed.error.issues)).toBe("Stop loss: number is too large to store accurately");
    }
  });

  it("has something to say with no issues", () => {
    expect(firstIssueMessage([])).toBe("That value isn't valid.");
  });
});

describe("fieldLabel", () => {
  it("turns a column name into words", () => {
    expect(fieldLabel("stop_loss")).toBe("Stop loss");
    expect(fieldLabel("shares")).toBe("Shares");
  });
});
