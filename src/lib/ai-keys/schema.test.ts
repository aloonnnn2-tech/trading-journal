import { describe, expect, it } from "vitest";
import { apiKeyCreateSchema } from "./schema";

const VALID_KEY = "sk-proj-abc123DEF456ghi789jkl";

describe("apiKeyCreateSchema", () => {
  it("accepts a well-formed payload and normalizes the label", () => {
    const parsed = apiKeyCreateSchema.parse({
      provider: "openai",
      key: `  ${VALID_KEY}  `,
      label: "  personal  ",
    });
    expect(parsed.key).toBe(VALID_KEY);
    expect(parsed.label).toBe("personal");
  });

  it("treats an omitted, empty, or whitespace label as null", () => {
    // All three must land on null so the picker never renders a blank chip.
    for (const label of [undefined, null, "", "   "]) {
      const parsed = apiKeyCreateSchema.parse({ provider: "openai", key: VALID_KEY, label });
      expect(parsed.label).toBeNull();
    }
  });

  it("accepts every provider the migration's check constraint allows", () => {
    for (const provider of ["openai", "anthropic", "google"]) {
      expect(apiKeyCreateSchema.safeParse({ provider, key: VALID_KEY }).success).toBe(true);
    }
  });

  it("rejects a provider the database would reject anyway", () => {
    // Catching it here is what turns a Postgres check-constraint violation
    // (500) into a clean 400.
    expect(apiKeyCreateSchema.safeParse({ provider: "cohere", key: VALID_KEY }).success).toBe(
      false,
    );
  });

  it("rejects keys that are too short to be real", () => {
    const result = apiKeyCreateSchema.safeParse({ provider: "openai", key: "sk-short" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/too short/);
  });

  it("rejects an unbounded key", () => {
    const result = apiKeyCreateSchema.safeParse({ provider: "openai", key: "s".repeat(501) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/too long/);
  });

  it("rejects keys containing whitespace or line breaks", () => {
    // The common paste error: a key copied with an embedded newline. Caught
    // at setup with a useful message rather than as a confusing provider 401.
    for (const key of [
      "sk-proj-abc123DEF456\nghi789jkl",
      "sk-proj-abc123 DEF456ghi789jkl",
      "sk-proj-abc123DEF456\tghi789jkl",
    ]) {
      const result = apiKeyCreateSchema.safeParse({ provider: "openai", key });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/spaces or invalid characters/);
    }
  });

  it("rejects a label that is too long", () => {
    const result = apiKeyCreateSchema.safeParse({
      provider: "openai",
      key: VALID_KEY,
      label: "l".repeat(61),
    });
    expect(result.success).toBe(false);
  });
});
