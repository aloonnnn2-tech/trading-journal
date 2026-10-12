import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDevSchema } from "./dev-schema";

const root = path.resolve(__dirname, "../..");
const migrationsDir = path.join(root, "supabase/migrations");

function migrations() {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: fs.readFileSync(path.join(migrationsDir, name), "utf8") }));
}

describe("dev schema", () => {
  it("supabase/dev/schema.sql matches the migrations (run `npm run dev-schema` if not)", () => {
    const committed = fs.readFileSync(path.join(root, "supabase/dev/schema.sql"), "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(buildDevSchema(migrations()));
  });

  it("skips the reset migration and keeps the rest in order", () => {
    const out = buildDevSchema([
      { name: "0002_b.sql", sql: "select 2;" },
      { name: "0000_reset.sql", sql: "drop table trades;" },
      { name: "0001_a.sql", sql: "select 1;" },
    ]);
    expect(out).not.toContain("drop table trades");
    expect(out.indexOf("select 1;")).toBeLessThan(out.indexOf("select 2;"));
  });
});
