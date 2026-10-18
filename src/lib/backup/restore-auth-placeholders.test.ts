import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { userIdsInBackup } from "../../../scripts/restore-auth-placeholders";

const A = "3f9a2b4c-1d2e-4f5a-8b6c-7d8e9f0a1b2c";
const B = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const dir = mkdtempSync(path.join(tmpdir(), "restore-ids-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("userIdsInBackup", () => {
  it("collects every distinct user_id across the dump, ignoring rows and files without one", () => {
    writeFileSync(path.join(dir, "trades.json"), JSON.stringify([{ user_id: A }, { user_id: A.toUpperCase() }, { user_id: B }]));
    writeFileSync(path.join(dir, "trade_folders.json"), JSON.stringify([{ trade_id: "t", folder_id: "f" }]));
    writeFileSync(path.join(dir, "admin_audit_log.json"), JSON.stringify([{ actor_id: "9" }]));
    writeFileSync(path.join(dir, "odd.json"), JSON.stringify({ not: "an array" }));
    writeFileSync(path.join(dir, "bad.json"), JSON.stringify([{ user_id: "../../etc" }, null]));
    writeFileSync(path.join(dir, "notes.txt"), "user_id: nope");
    expect(userIdsInBackup(dir)).toEqual([B, A].sort());
  });
});
