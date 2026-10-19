import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BACKUP_EXCLUDED, TABLES } from "../../../scripts/db-tables";

// Security gaps pass, G-7: the backup's table list has gone stale three
// times, silently each time. This reads every migration on disk and holds
// scripts/db-tables.ts to it -- the same kind of guard data-export.test.ts
// gives the data export.

const dir = path.resolve(__dirname, "../../../supabase/migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(dir, f), "utf8").replace(/--[^\n]*/g, ""))
  .join("\n");

const created = new Set(
  [...sql.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()),
);

/** child -> the public tables its foreign keys point at. */
function foreignKeys(): Map<string, Set<string>> {
  const fks = new Map<string, Set<string>>();
  const add = (child: string, parent: string) => {
    if (child === parent) return;
    if (!fks.has(child)) fks.set(child, new Set());
    fks.get(child)!.add(parent);
  };
  // Inside each create table ( ... ); body.
  for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/gi)) {
    for (const r of m[2].matchAll(/references (?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
      if (r[1].toLowerCase() !== "auth") add(m[1].toLowerCase(), r[1].toLowerCase());
    }
  }
  // Columns added later: alter table x add column ... references y (...)
  for (const m of sql.matchAll(/alter table (?:if exists )?(?:public\.)?([a-z_][a-z0-9_]*)\s+add column[^;]*?references (?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
    add(m[1].toLowerCase(), m[2].toLowerCase());
  }
  return fks;
}

describe("scripts/db-tables.ts against the migrations", () => {
  it("finds the tables (sanity: the parser works)", () => {
    expect(created.has("trades")).toBe(true);
    expect(created.has("admin_audit_log")).toBe(true);
    expect(created.size).toBeGreaterThan(25);
  });

  it("backs up or explicitly excludes every table a migration creates", () => {
    const listed = new Set<string>([...TABLES, ...Object.keys(BACKUP_EXCLUDED)]);
    expect([...created].filter((t) => !listed.has(t))).toEqual([]);
  });

  it("never both backs up and excludes a table, and names no table twice", () => {
    expect(TABLES.filter((t) => t in BACKUP_EXCLUDED)).toEqual([]);
    expect(new Set(TABLES).size).toBe(TABLES.length);
  });

  it("gives every exclusion a reason", () => {
    for (const reason of Object.values(BACKUP_EXCLUDED)) expect(reason.length).toBeGreaterThan(10);
  });

  it("lists each table after the tables its foreign keys need, so a restore can insert in order", () => {
    const position = new Map<string, number>(TABLES.map((t, i) => [t, i]));
    const outOfOrder: string[] = [];
    for (const [child, parents] of foreignKeys()) {
      if (!position.has(child)) continue;
      for (const parent of parents) {
        if (position.has(parent) && position.get(parent)! > position.get(child)!) {
          outOfOrder.push(`${child} before its parent ${parent}`);
        }
      }
    }
    expect(outOfOrder).toEqual([]);
  });
});
