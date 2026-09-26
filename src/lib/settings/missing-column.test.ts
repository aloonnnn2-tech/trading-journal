import { describe, expect, it } from "vitest";
import { isMissingColumnError } from "./queries";

// Migrations here are applied by hand, so "code deployed, migration not yet
// run" is a state the app really passes through. Both codes below were seen
// against the live database with 0049 unapplied; checking only the first
// turned every paid-offer write into a 500.
describe("isMissingColumnError", () => {
  it("recognises a SELECT naming a missing column (Postgres)", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
  });

  it("recognises an UPDATE payload naming a missing column (PostgREST)", () => {
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
  });

  it("does not swallow other errors", () => {
    expect(isMissingColumnError({ code: "42501" })).toBe(false); // permission denied
    expect(isMissingColumnError({ code: "PGRST116" })).toBe(false); // no rows
    expect(isMissingColumnError({})).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError(undefined)).toBe(false);
    expect(isMissingColumnError(new Error("boom"))).toBe(false);
  });
});
