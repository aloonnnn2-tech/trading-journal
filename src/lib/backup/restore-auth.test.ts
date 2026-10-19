import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { accountsInBackup, AUTH_USERS_FILE } from "../../../scripts/restore-auth";

const A = "3f9a2b4c-1d2e-4f5a-8b6c-7d8e9f0a1b2c";
const B = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const C = "11111111-2222-4333-8444-555555555555";
const dirs: string[] = [];
const dump = (files: Record<string, unknown>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "restore-auth-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("accountsInBackup", () => {
  it("takes accounts from the account list, with their email and confirmed state", () => {
    const dir = dump({
      [AUTH_USERS_FILE]: [
        { id: A, email: "a@example.com", email_confirmed_at: "2026-09-01T00:00:00Z" },
        { id: B, email: "b@example.com", email_confirmed_at: null },
      ],
      "trades.json": [{ user_id: A }],
    });
    expect(accountsInBackup(dir)).toEqual(
      [
        { id: A, email: "a@example.com", confirmed: true },
        { id: B, email: "b@example.com", confirmed: false },
      ].sort((x, y) => x.id.localeCompare(y.id)),
    );
  });

  it("adds any account a row names but the list doesn't, without an email (older backups)", () => {
    const dir = dump({
      "trades.json": [{ user_id: A }, { user_id: A.toUpperCase() }, { user_id: C }],
      "trade_folders.json": [{ trade_id: "t", folder_id: "f" }],
      "admin_audit_log.json": [{ actor_id: "9" }],
      "waitlist.json": [{ email: "w@example.com" }],
      "odd.json": { not: "an array" },
      "bad.json": [{ user_id: "../../etc" }, null],
      "notes.txt": "user_id: nope",
    });
    expect(accountsInBackup(dir)).toEqual(
      [
        { id: A, email: null, confirmed: false },
        { id: C, email: null, confirmed: false },
      ].sort((x, y) => x.id.localeCompare(y.id)),
    );
  });

  it("ignores malformed entries in the account list", () => {
    const dir = dump({ [AUTH_USERS_FILE]: [{ id: "nope", email: "x@example.com" }, null, { id: B, email: "not-an-email" }] });
    expect(accountsInBackup(dir)).toEqual([{ id: B, email: null, confirmed: false }]);
  });
});
