import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "./preferences";
import { parsePreferences, preferencesPatchSchema } from "./preferences-schema";

describe("parsePreferences", () => {
  it("fills every field with its default when nothing is stored", () => {
    expect(parsePreferences({})).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences([])).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid fields and drops only the bad ones", () => {
    expect(parsePreferences({ keyboardShortcuts: false, theme: "sepia", tradePreview: "yes" })).toEqual({
      ...DEFAULT_PREFERENCES,
      keyboardShortcuts: false,
    });
  });

  it("ignores keys it doesn't know", () => {
    expect(parsePreferences({ is_admin: true, hoverMotion: false })).toEqual({ ...DEFAULT_PREFERENCES, hoverMotion: false });
  });

  it("reads a saved theme, and null as 'this browser decides'", () => {
    expect(parsePreferences({ theme: "dark" }).theme).toBe("dark");
    expect(parsePreferences({ theme: null }).theme).toBeNull();
  });
});

describe("preferencesPatchSchema", () => {
  it("accepts any subset and refuses unknown keys", () => {
    expect(preferencesPatchSchema.safeParse({ tourOffers: false }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ plan: "paid" }).success).toBe(false);
  });
});
