import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXCLUDED_TABLES, EXPORT_SECTIONS, EXPORTED_TABLES } from "./data-export";

// Prevention: the "download all my data" export must not silently fall
// behind the schema. Every table any migration creates must be either
// exported or listed in EXCLUDED_TABLES with a reason.

const migrations = path.resolve(__dirname, "../../../supabase/migrations");

function tablesCreated(): Set<string> {
  const out = new Set<string>();
  for (const f of fs.readdirSync(migrations).filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(migrations, f), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)/gi)) {
      out.add(m[1].toLowerCase());
    }
  }
  return out;
}

describe("data export coverage", () => {
  it("every table a migration creates is exported or deliberately excluded", () => {
    const covered = new Set([...EXPORTED_TABLES, ...Object.keys(EXCLUDED_TABLES)]);
    const missing = [...tablesCreated()].filter((t) => !covered.has(t));
    expect(missing, "add these to EXPORT_SECTIONS or EXCLUDED_TABLES").toEqual([]);
  });

  it("section names are unique", () => {
    const names = EXPORT_SECTIONS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("never exports the encrypted AI key column", () => {
    const src = fs.readFileSync(path.join(__dirname, "data-export.ts"), "utf8");
    const keysSection = src.slice(src.indexOf('name: "ai_keys"'), src.indexOf('name: "screenshots"'));
    expect(keysSection).not.toMatch(/encrypted_key|"\*"/);
  });
});
