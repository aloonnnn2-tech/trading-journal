import { describe, expect, it } from "vitest";
import { otpType, safeDestination } from "./confirm-link";

const ORIGIN = "https://tradinglenz.netlify.app";

describe("safeDestination", () => {
  it("keeps a path on this site", () => {
    expect(safeDestination("/reset-password", ORIGIN).href).toBe(`${ORIGIN}/reset-password`);
  });

  it("defaults to the dashboard", () => {
    expect(safeDestination(null, ORIGIN).href).toBe(`${ORIGIN}/dashboard`);
  });

  it("refuses another site, however it is spelled", () => {
    for (const next of ["https://example.com", "//example.com", "/\\example.com", "http:example.com"]) {
      expect(safeDestination(next, ORIGIN).origin, next).toBe(ORIGIN);
    }
  });
});

describe("otpType", () => {
  it("accepts Supabase's email link types and nothing else", () => {
    expect(otpType("signup")).toBe("signup");
    expect(otpType("recovery")).toBe("recovery");
    expect(otpType("sms")).toBeNull();
    expect(otpType(null)).toBeNull();
  });
});
