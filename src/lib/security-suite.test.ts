import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SECURITY_SUITE, SECURITY_TEST_FILES } from "../../tests/security/suite";

// Keeps tests/security/suite.ts honest (security gaps pass, 7.1): a renamed
// or deleted test would otherwise drop out of `npm run test:security`
// silently, which is the failure a regression suite exists to prevent.

const ROOT = path.resolve(__dirname, "../..");

function testFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return testFiles(rel);
    return e.name.endsWith(".test.ts") ? [rel] : [];
  });
}

describe("the security suite index", () => {
  it("lists only files that exist", () => {
    expect(SECURITY_TEST_FILES.filter((f) => !existsSync(path.join(ROOT, f)))).toEqual([]);
  });

  it("lists every file named as a security test", () => {
    const named = testFiles("src").filter((f) => /\.(security|enumeration|drift)\.test\.ts$/.test(f));
    expect(named.length).toBeGreaterThan(5);
    expect(named.filter((f) => !SECURITY_TEST_FILES.includes(f))).toEqual([]);
  });

  it("names no file twice and leaves no category empty", () => {
    expect(new Set(SECURITY_TEST_FILES).size).toBe(SECURITY_TEST_FILES.length);
    for (const [category, files] of Object.entries(SECURITY_SUITE)) expect(files.length, category).toBeGreaterThan(0);
  });
});
