/**
 * Builds supabase/dev/schema.sql: every migration from 0001 on, in order, as
 * one file to paste into the SQL editor of the DEV Supabase project.
 *
 *   npm run dev-schema          # rewrite the file
 *   npm run dev-schema -- --check   # exit 1 if the file is out of date
 *
 * Why it exists: the IDOR (cross-user) tests, seed scripts and e2e must run
 * against a separate dev project, never the live one (security hardening,
 * Phase 1). That project starts empty, and pasting 59 files one by one is
 * where a step gets skipped. One file, rebuilt from the migrations, cannot
 * drift from them -- `src/lib/dev-schema.test.ts` fails if it does.
 *
 * 0000_reset.sql is skipped: it drops tables, and an empty project has none.
 * The SQL editor runs the whole file as one transaction, so a failure part
 * way leaves the dev project untouched rather than half-built.
 */
import fs from "node:fs";
import path from "node:path";
import { buildDevSchema } from "../src/lib/dev-schema";

const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "supabase/migrations");
const outFile = path.join(root, "supabase/dev/schema.sql");

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: fs.readFileSync(path.join(migrationsDir, name), "utf8") }));

const built = buildDevSchema(files);

if (process.argv.includes("--check")) {
  // Git may check the file out with CRLF on Windows; compare content, not line endings.
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== built) {
    console.error("supabase/dev/schema.sql is out of date. Run: npm run dev-schema");
    process.exit(1);
  }
  console.log("supabase/dev/schema.sql is up to date.");
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, built);
  console.log(`Wrote supabase/dev/schema.sql (${files.length - 1} migrations).`);
}
