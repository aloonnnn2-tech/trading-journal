import { describe, expect, it } from "vitest";
import { bodyLimitFor, declaredBodyTooLarge, DEFAULT_BODY_LIMIT, LARGE_BODY_LIMIT } from "./body-limits";

describe("bodyLimitFor", () => {
  it("gives uploads and imports the large tier", () => {
    for (const p of [
      "/api/ocr/parse",
      "/api/trades/3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b/images",
      "/api/trades/import",
      "/api/trades/import-json",
      "/api/trades/import/parse-xlsx",
    ]) {
      expect(bodyLimitFor(p), p).toBe(LARGE_BODY_LIMIT);
    }
  });

  it("gives everything else the default, including look-alike paths", () => {
    for (const p of [
      "/api/trades",
      "/api/trades/abc",
      "/api/trades/abc/images/def",
      "/api/chat/conversations/abc/turn",
      "/api/trades/import/extra",
      "/api/ocr/parse/x",
    ]) {
      expect(bodyLimitFor(p), p).toBe(DEFAULT_BODY_LIMIT);
    }
  });
});

describe("declaredBodyTooLarge", () => {
  it("refuses a declared size over the path's limit", () => {
    expect(declaredBodyTooLarge("/api/trades/abc", String(DEFAULT_BODY_LIMIT + 1))).toBe(true);
    expect(declaredBodyTooLarge("/api/ocr/parse", String(LARGE_BODY_LIMIT + 1))).toBe(true);
  });

  it("allows sizes at or under the limit", () => {
    expect(declaredBodyTooLarge("/api/trades/abc", String(DEFAULT_BODY_LIMIT))).toBe(false);
    expect(declaredBodyTooLarge("/api/ocr/parse", String(5 * 1024 * 1024))).toBe(false);
  });

  it("lets a missing header through (the platform bounds those) but refuses a malformed one", () => {
    expect(declaredBodyTooLarge("/api/trades/abc", null)).toBe(false);
    expect(declaredBodyTooLarge("/api/trades/abc", "lots")).toBe(true);
    expect(declaredBodyTooLarge("/api/trades/abc", "-5")).toBe(true);
  });
});
