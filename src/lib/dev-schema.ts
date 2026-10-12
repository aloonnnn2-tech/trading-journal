/**
 * Concatenates migrations into the one-paste schema for the DEV Supabase
 * project. Pure so the drift test can rebuild it without touching disk
 * output. See scripts/build-dev-schema.ts.
 */

export interface MigrationFile {
  name: string;
  sql: string;
}

/** Drops and recreates tables -- meaningless on an empty project. */
const SKIP = new Set(["0000_reset.sql"]);

export function buildDevSchema(files: MigrationFile[]): string {
  const included = files
    .filter((f) => !SKIP.has(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const header = [
    "-- GENERATED FILE -- do not edit. Rebuild with: npm run dev-schema",
    "--",
    "-- DEV SUPABASE PROJECT ONLY. Paste this whole file into the SQL editor of",
    "-- the dev project (the one in .env.test.local), never the live one.",
    "-- It runs as one transaction: if any statement fails, nothing is kept.",
    "--",
    `-- Contains ${included.length} migrations: ${included[0]?.name} .. ${included[included.length - 1]?.name}`,
    "",
  ].join("\n");

  const body = included
    .map((f) => `-- ===== ${f.name} =====\n${f.sql.replace(/\r\n/g, "\n").trimEnd()}\n`)
    .join("\n");

  return `${header}\n${body}`;
}
