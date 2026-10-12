import { describe, expect, it } from "vitest";
import { assertDevSupabase, DevGuardError } from "./dev-guard";

const PROD = "https://prodprojectref.supabase.co";
const DEV = "https://devprojectref.supabase.co";

describe("assertDevSupabase", () => {
  it("passes a dev project that is not production", () => {
    expect(assertDevSupabase(DEV, PROD)).toBe("devprojectref.supabase.co");
  });

  it("refuses the production project, whatever the casing or path", () => {
    expect(() => assertDevSupabase(PROD, PROD)).toThrow(/PRODUCTION/);
    expect(() => assertDevSupabase("https://PRODPROJECTREF.supabase.co/rest/v1", PROD)).toThrow(DevGuardError);
  });

  it("fails closed when either URL is missing or malformed", () => {
    expect(() => assertDevSupabase(undefined, PROD)).toThrow(/SUPABASE_DEV_URL is not set/);
    expect(() => assertDevSupabase(DEV, undefined)).toThrow(/production Supabase URL/);
    expect(() => assertDevSupabase("not a url", PROD)).toThrow(/not a valid URL/);
  });

  it("refuses anything that is not a Supabase project", () => {
    expect(() => assertDevSupabase("http://localhost:54321", PROD)).toThrow(/supabase\.co/);
  });
});
