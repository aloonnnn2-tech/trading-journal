/**
 * Restores a scripts/backup-db.ts dump back into a Supabase project.
 *
 * **Why this exists.** Until now the project had backups and no way to use
 * them: thirteen JSON files and an implicit plan to sort it out by hand
 * during whatever emergency had just happened. A backup nobody can restore is
 * a hope, not a recovery path.
 *
 * Run with:
 *   npm run restore:db                      # dry run against newest backup
 *   npm run restore:db -- --dir backups/... # dry run against a chosen one
 *   npm run restore:db -- --apply           # actually write
 *
 * **Dry run is the default and that is deliberate.** This writes with the
 * service-role key, which bypasses every RLS policy in the database -- the
 * one credential that can overwrite every user's data at once. A tool that
 * did that on a bare invocation would be one mistyped command away from a
 * second disaster on top of the first.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CANNOT DO, READ BEFORE RELYING ON IT
 *
 * 1. **This script does not create accounts**, and every table has a
 *    `user_id` foreign key into auth.users. Restoring into a fresh project
 *    therefore fails on the first row unless the accounts already exist
 *    there WITH THE SAME UUIDs: run scripts/restore-auth.ts first (it reads
 *    the backup's account list). Signing up again mints a new id and won't do.
 *    Restoring into the SAME project (the realistic case: a bad migration or
 *    a bulk delete) is fine, because the users are still there.
 *
 * 2. **Schema is not in the backup.** A fresh project needs every file in
 *    supabase/migrations applied first, or the tables these rows go into do
 *    not exist.
 *
 * 3. **Screenshots are restored separately.** Since 2026-10-16 the backup
 *    holds the trade-images files too; this script restores only the rows,
 *    and `npm run restore:storage` puts the files back (rows first).
 *
 * 4. **Accounts come first, from scripts/restore-auth.ts** (the backup's
 *    auth_users.json, since 2026-10-19). The audit log is only restored
 *    into an empty table (APPEND_ONLY below).
 *
 * So this covers "the rows were damaged and the project is otherwise intact",
 * which is the failure that actually happens. Full project loss needs the
 * auth users recreated with the same ids first; the drill for that is
 * docs/security/restore-test.md. Supabase's own daily backups start on the
 * Pro plan (7 days; point-in-time recovery is a paid add-on on top), and the
 * free plan has none: these files are the only copy.
 * ---------------------------------------------------------------------------
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TABLES } from "./db-tables";

/** Rows per upsert request. PostgREST handles a few thousand comfortably;
 *  this stays well under any statement-size limit while keeping round-trips
 *  to a sane number for a dump of this size. */
const CHUNK_SIZE = 500;

interface Args {
  dir: string | null;
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const dirIndex = argv.indexOf("--dir");
  return {
    dir: dirIndex !== -1 ? argv[dirIndex + 1] ?? null : null,
    apply: argv.includes("--apply"),
  };
}

/**
 * Newest backup by directory name. backup-db.ts stamps directories with an
 * ISO timestamp (colons replaced), which sorts lexicographically in
 * chronological order -- so this is a plain sort, not a date parse.
 */
function newestBackupDir(): string | null {
  const root = path.join(process.cwd(), "backups");
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return dirs.length > 0 ? path.join(root, dirs[dirs.length - 1]) : null;
}

function readTable(dir: string, table: string): Record<string, unknown>[] | null {
  const file = path.join(dir, `${table}.json`);
  if (!existsSync(file)) return null;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${table}.json is not a JSON array`);
  return parsed as Record<string, unknown>[];
}

/**
 * Append-only tables whose id is `generated always` (0072): Postgres refuses
 * an explicit id, so they can't be upserted. They are restored only into an
 * EMPTY table, without their ids; a table that already has rows (a restore
 * into the same project) is left alone -- the log it holds is newer than the
 * backup, and appending the backup again would duplicate every entry.
 */
const APPEND_ONLY = new Set(["admin_audit_log"]);

async function restoreAppendOnly(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<string> {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: could not count existing rows -- ${error.message}`);
  if ((count ?? 0) > 0) return `kept as is (already has ${count} rows; append-only)`;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE).map(({ id: _id, ...rest }) => rest);
    const { error: insertError } = await supabase.from(table).insert(chunk);
    if (insertError) throw new Error(`${table}: rows ${i}-${i + chunk.length - 1} failed -- ${insertError.message}`);
  }
  return `${String(rows.length).padStart(6)} rows restored (new ids)`;
}

async function restoreTable(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    // upsert, not insert: restoring twice, or restoring over rows that partly
    // survived, must converge rather than fail on a duplicate key. The backup
    // is the intended truth, so an existing row is overwritten.
    const { error } = await supabase.from(table).upsert(chunk);
    if (error) {
      throw new Error(
        `${table}: rows ${i}-${i + chunk.length - 1} failed -- ${error.message}` +
          (error.code === "23503"
            ? "\n  (23503 is a foreign key violation. If this is a fresh project, the" +
              "\n   auth.users rows these reference do not exist -- see the header.)"
            : ""),
      );
    }
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).");
    return 2;
  }

  const dir = args.dir ? path.resolve(args.dir) : newestBackupDir();
  if (!dir || !existsSync(dir)) {
    console.error(
      dir
        ? `No such backup directory: ${dir}`
        : "No backups found under ./backups -- run `npm run backup:db` first, or pass --dir.",
    );
    return 2;
  }

  // Naming the target explicitly, every run. The single worst outcome here is
  // restoring an old dump over a healthy production database because the
  // wrong .env.local was loaded, and the only defence a script can offer is
  // to say out loud which project it is about to write to.
  console.log(`Backup: ${dir}`);
  console.log(`Target: ${url}`);
  console.log(args.apply ? "Mode:   APPLY (will write)\n" : "Mode:   dry run (no writes)\n");

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const plan: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
  const missing: string[] = [];

  for (const table of TABLES) {
    const rows = readTable(dir, table);
    if (rows === null) {
      missing.push(table);
      continue;
    }
    plan.push({ table, rows });
  }

  for (const { table, rows } of plan) {
    console.log(`  ${table.padEnd(22)} ${String(rows.length).padStart(6)} rows`);
  }

  if (missing.length > 0) {
    // Expected for any backup taken before the table list was corrected on
    // 2026-09-08 -- those dumps predate six of these tables. Worth stating
    // plainly rather than restoring silently partial data.
    console.log(
      `\nNot present in this backup (${missing.length}):\n` +
        missing.map((t) => `  ${t}`).join("\n") +
        `\nThese tables will be left exactly as they are in the target project.`,
    );
  }

  const total = plan.reduce((sum, { rows }) => sum + rows.length, 0);
  console.log(`\n${total} rows across ${plan.length} tables.`);

  if (!args.apply) {
    console.log(
      "\nDry run only -- nothing was written.\n" +
        "Re-run with `npm run restore:db -- --apply` to write, and read the\n" +
        "header of this script first if the target is a fresh project.",
    );
    return 0;
  }

  console.log("\nWriting...\n");
  for (const { table, rows } of plan) {
    if (rows.length === 0) {
      console.log(`  ${table.padEnd(22)} skipped (empty)`);
      continue;
    }
    if (APPEND_ONLY.has(table)) {
      console.log(`  ${table.padEnd(22)} ${await restoreAppendOnly(supabase, table, rows)}`);
      continue;
    }
    await restoreTable(supabase, table, rows);
    console.log(`  ${table.padEnd(22)} ${String(rows.length).padStart(6)} rows restored`);
  }

  console.log(
    `\nDone. ${total} rows restored.\n` +
      "Trade screenshot images are NOT restored -- trade_images rows now point\n" +
      "at Storage objects that this backup never contained.",
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`\nRestore failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error("\nNothing is rolled back -- tables before the failure are already written.");
    process.exitCode = 1;
  },
);
