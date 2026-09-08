/**
 * Reports which files in supabase/migrations have actually been applied to the
 * live database, and which are still pending.
 *
 * This project applies migrations BY HAND in the Supabase SQL editor (see the
 * header of every file in supabase/migrations) and that is not changing. What
 * changed in 0040 is that each file now records itself into a
 * `schema_migrations` table as it runs, so the applied/pending split is a fact
 * this script can read back instead of something someone has to remember.
 *
 * It reads only. It never applies SQL -- deliberately, and there is no flag to
 * make it. `check-rpc-parity.ts` exists precisely because a fix once shipped
 * in JS while its migration sat unapplied; this is the cheaper check that
 * would have caught the same thing first.
 *
 * Run with:
 *   npm run migrations:status
 *
 * Exit codes:
 *   0  every file applied, or only trailing files pending (the normal state
 *      between writing a migration and pasting it in)
 *   1  a GAP -- a file is pending while a LATER-numbered one is applied, which
 *      almost always means one got skipped
 *   2  could not check at all (missing env, unreachable database, or the
 *      schema_migrations table itself not applied yet)
 */
import { createClient } from "@supabase/supabase-js";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

/** The migration that creates the tracking table -- named for the hint below. */
const BOOTSTRAP_MIGRATION = "0040_schema_migrations.sql";

interface AppliedRow {
  filename: string;
  applied_at: string;
}

/**
 * Files are named `00NN_description.sql`. The numeric prefix -- not the string
 * sort -- is what "later than" means below, so that a future 0100 sorts after
 * 0099 rather than between 0009 and 0010.
 */
function migrationNumber(filename: string): number {
  const match = /^(\d+)_/.exec(filename);
  return match ? Number(match[1]) : Number.NaN;
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => migrationNumber(a) - migrationNumber(b));
}

/**
 * Returns the process exit code rather than calling process.exit() anywhere.
 *
 * Not style: on Windows, process.exit() while the Supabase client's undici
 * socket is still closing trips a libuv assertion
 * (`!(handle->flags & UV_HANDLE_CLOSING)`) that replaces the real exit code
 * with 127. Since the whole point of the gap check is an exit code CI can
 * branch on, the code has to survive the exit -- so set it and let the event
 * loop drain instead.
 */
async function main(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
        "They live in .env.local, which this script loads via --env-file (see package.json).\n" +
        "The service-role key is required because 0040 revokes anon/authenticated\n" +
        "access to schema_migrations -- the anon key cannot see the table at all.",
    );
    return 2;
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("schema_migrations")
    .select("filename, applied_at")
    .order("filename");

  if (error) {
    // Same 42P01/PGRST205 pair src/lib/supabase/errors.ts detects. Repeated
    // rather than imported: that module lives under src/ and this script runs
    // outside Next's module resolution, and two codes are cheaper to restate
    // than a build-time dependency on the app.
    if (error.code === "42P01" || error.code === "PGRST205") {
      console.error(
        `schema_migrations does not exist yet.\n\n` +
          `Apply supabase/migrations/${BOOTSTRAP_MIGRATION} in the Supabase SQL editor first --\n` +
          `it creates the table and backfills every migration through 0039.`,
      );
      return 2;
    }
    console.error(`Could not read schema_migrations: ${error.message} (${error.code ?? "no code"})`);
    return 2;
  }

  const rows = (data ?? []) as AppliedRow[];
  const appliedAt = new Map(rows.map((row) => [row.filename, row.applied_at]));
  const files = listMigrationFiles();

  const applied = files.filter((file) => appliedAt.has(file));
  const pending = files.filter((file) => !appliedAt.has(file));

  // Rows with no matching file: a migration was applied and its file later
  // renamed or deleted. Harmless to the gap check, but worth surfacing --
  // it means the repo no longer describes what is actually in the database.
  const knownFiles = new Set(files);
  const orphans = rows.filter((row) => !knownFiles.has(row.filename)).map((row) => row.filename);

  console.log(`${MIGRATIONS_DIR}\n`);
  for (const file of files) {
    const when = appliedAt.get(file);
    console.log(
      when
        ? `  applied  ${file.padEnd(52)} ${new Date(when).toISOString().slice(0, 10)}`
        : `  PENDING  ${file}`,
    );
  }

  console.log(`\n${applied.length} applied, ${pending.length} pending, ${files.length} total.`);

  if (orphans.length > 0) {
    console.log(
      `\nRecorded applied but no longer in the repo (renamed or deleted?):\n` +
        orphans.map((name) => `  ${name}`).join("\n"),
    );
  }

  // THE GAP CHECK, AND WHY IT IS NOT "ANY PENDING FILE IS AN ERROR". Writing a
  // migration and not having pasted it in yet is the normal working state --
  // failing on that would make this script something people mute. What is
  // never normal is a pending file with an APPLIED file numbered after it:
  // that ordering can only happen if one was skipped, and the skipped one is
  // usually the reason something is quietly broken.
  const highestApplied = applied.reduce((max, file) => Math.max(max, migrationNumber(file)), -1);
  const gaps = pending.filter((file) => migrationNumber(file) < highestApplied);

  if (gaps.length > 0) {
    console.error(
      `\nGAP: these are pending, but a later migration is already applied --\n` +
        `they were almost certainly skipped:\n` +
        gaps.map((name) => `  ${name}`).join("\n"),
    );
    return 1;
  }

  if (pending.length > 0) {
    console.log(
      `\nNothing skipped -- the pending files are all newer than everything applied.\n` +
        `Paste them into the Supabase SQL editor in order when ready.`,
    );
  }

  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 2;
  },
);
