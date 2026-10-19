import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every script, test or fixture that creates accounts must be pinned to the
// DEV project (loadDevProject / assertDevSupabase), so none can make users on
// the live site again (hardening brief, final task: six such accounts were
// found there on 2026-10-10). The app's own sign-up page is not a "creator"
// here: it is the product.

const ROOT = path.resolve(__dirname, "../../..");
const DIRS = ["scripts", "e2e", "tests"];
const CREATES = /\.(createUser|signUp)\(/;
const GUARDED = /\b(loadDevProject|assertDevSupabase)\b/;

/** Files allowed to create accounts without the guard in the file itself. */
const ALLOWED: Record<string, string> = {
  "scripts/seed-demo-account.mjs": "the one deliberate production account (demo@tradinglens.app), excluded from analytics",
  "tests/idor/world.ts": "runs only under vitest.idor.config.mts, whose setupFile tests/idor/env.ts calls loadDevProject",
  "scripts/restore-auth.ts":
    "restore drill / disaster recovery: its target is a fresh project by design; it refuses the live project named in .env.local and any project that already has accounts",
};

function files(dir: string): string[] {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(rel);
    return /\.(m?[jt]s)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [rel] : [];
  });
}

describe("account-creating code is pinned to the dev project", () => {
  const creators = DIRS.flatMap(files).filter((f) => CREATES.test(fs.readFileSync(path.join(ROOT, f), "utf8")));

  it("finds the known creators (the scan works)", () => {
    expect(creators).toEqual(expect.arrayContaining(["e2e/fixtures/test-user.ts", "scripts/seed-fake-data.mjs"]));
  });

  it.each(creators.map((f) => [f]))("%s refuses production", (file) => {
    if (ALLOWED[file]) return;
    expect(GUARDED.test(fs.readFileSync(path.join(ROOT, file), "utf8")), `${file} creates accounts without loadDevProject`).toBe(true);
  });

  it("the idor setup file really does guard", () => {
    expect(fs.readFileSync(path.join(ROOT, "vitest.idor.config.mts"), "utf8")).toMatch(/tests\/idor\/env\.ts/);
    expect(fs.readFileSync(path.join(ROOT, "tests/idor/env.ts"), "utf8")).toMatch(/loadDevProject/);
  });
});
