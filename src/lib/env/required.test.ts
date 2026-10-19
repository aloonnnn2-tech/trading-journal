import { describe, expect, it } from "vitest";
import { BUILD_REQUIRED, missingEnv, missingEnvMessage } from "./required";

describe("missingEnv", () => {
  it("names every required variable that is unset or blank", () => {
    expect(missingEnv(BUILD_REQUIRED, { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "  " })).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
    expect(missingEnv(BUILD_REQUIRED, { NEXT_PUBLIC_SUPABASE_URL: "u", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toEqual([]);
  });

  it("says which ones, and where to look", () => {
    expect(missingEnvMessage(["A", "B"], "next build")).toBe(
      "next build: missing environment variables A, B. See .env.local.example.",
    );
  });
});
