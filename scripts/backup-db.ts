/**
 * Backup of every user-data table to local JSON.
 *
 * Supabase's free plan has no automated backups (confirmed via the
 * Management API: pitr_enabled: false, zero stored backups) and the project
 * is staying on the free plan, so this is the only recovery path if
 * something goes wrong.
 *
 * Uses the service-role key to bypass RLS, so it captures every user's data
 * in one pass, not just one account's.
 *
 * Run with:
 *   npm run backup:db
 *
 * **This is no longer only manual.** .github/workflows/backup.yml runs it
 * daily and weekly and keeps the output as an encrypted artifact -- because
 * relying on someone remembering did not work: between 2026-08-13 and
 * 2026-09-08 exactly one backup existed. Still run it by hand before risky
 * changes (migrations, bulk edits); the schedule is the floor, not the plan.
 *
 * **Screenshots are included** (since 2026-10-16): every file in the
 * trade-images bucket, under storage/trade-images/ -- see dumpStorage below.
 *
 * **What this does NOT capture, and it matters when reading a dump as
 * "the backup":**
 *  - auth.users. Every table below has a user_id foreign key into it, so
 *    these rows cannot be restored into a project until the matching auth
 *    users exist with the SAME ids. scripts/restore-db.ts says so directly
 *    and refuses to pretend otherwise.
 *  - Schema, RLS policies, functions, triggers. This is a row dump; the
 *    structure comes from re-applying supabase/migrations.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Moved to its own module so scripts/restore-db.ts can share it -- the two
// disagreeing about what "the data" is would make a restore quietly partial.
// That module also documents the six tables this list was missing until
// 2026-09-08, and the rule for keeping it current.
import { TABLES } from "./db-tables";

// PostgREST caps any single response at 1,000 rows regardless of .limit() --
// this codebase has hit that exact bug in the app itself more than once, so
// paginate explicitly rather than repeat it here.
const PAGE_SIZE = 1000;

async function dumpTable(
  supabase: ReturnType<typeof createClient>,
  table: string,
): Promise<unknown[] | null> {
  const rows: unknown[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      // A table in db-tables.ts whose migration has not been applied yet is
      // an ordinary state in this project -- migrations are pasted in by
      // hand, so the code always runs ahead of the database for a while
      // (src/lib/supabase/errors.ts exists for the same reason). Aborting the
      // whole backup over it would mean one pending migration silently costs
      // you every backup until someone notices, which is the opposite of what
      // this script is for. Skip it, say so, and dump everything else.
      if (error.code === "42P01" || error.code === "PGRST205") return null;
      throw new Error(`${table}: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

// The trade screenshots. Supabase's own backups never include Storage (and
// the free plan has none anyway), so without this a lost bucket was lost for
// good. Files sit at <userId>/<tradeId>/<file>; list() returns one level at a
// time, so walk it. Written under storage/<bucket>/ next to the table dumps,
// plus a manifest, and restored by scripts/restore-storage.ts.
const STORAGE_BUCKETS = ["trade-images"];

async function listAll(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  prefix = "",
): Promise<{ path: string; size: number | null }[]> {
  const files: { path: string; size: number | null }[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: PAGE_SIZE, offset });
    if (error) throw new Error(`storage ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A folder has no id; a file does.
      if (entry.id === null) files.push(...(await listAll(supabase, bucket, full)));
      else files.push({ path: full, size: (entry.metadata as { size?: number } | null)?.size ?? null });
    }
    if (data.length < PAGE_SIZE) break;
  }
  return files;
}

async function dumpStorage(supabase: ReturnType<typeof createClient>, outDir: string) {
  for (const bucket of STORAGE_BUCKETS) {
    let files: { path: string; size: number | null }[];
    try {
      files = await listAll(supabase, bucket);
    } catch (err) {
      // The table dump above is still worth keeping: say so and carry on.
      console.log(`  storage ${bucket}: could not list (${(err as Error).message}) -- skipped`);
      continue;
    }
    const root = path.join(outDir, "storage", bucket);
    let bytes = 0;
    const failed: string[] = [];
    for (const file of files) {
      const { data, error } = await supabase.storage.from(bucket).download(file.path);
      if (error || !data) {
        failed.push(file.path);
        continue;
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      const target = path.join(root, ...file.path.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, buffer);
      bytes += buffer.length;
    }
    writeFileSync(
      path.join(outDir, "storage", `${bucket}.manifest.json`),
      JSON.stringify({ bucket, files: files.map((f) => f.path), failed }, null, 2),
    );
    console.log(
      `  storage ${bucket}: ${files.length - failed.length} of ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`,
    );
    // A file that couldn't be read means this backup is missing it: fail the
    // run so it shows red, rather than pass with a hole in it.
    if (failed.length > 0) throw new Error(`storage ${bucket}: ${failed.length} file(s) could not be downloaded`);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).");
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "backups", stamp);
  mkdirSync(outDir, { recursive: true });

  console.log(`Backing up to ${outDir}\n`);

  let totalRows = 0;
  let dumped = 0;
  const absent: string[] = [];

  for (const table of TABLES) {
    const rows = await dumpTable(supabase, table);
    if (rows === null) {
      absent.push(table);
      console.log(`  ${table}: not in the database (migration pending?) -- skipped`);
      continue;
    }
    writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(rows, null, 2));
    totalRows += rows.length;
    dumped += 1;
    // Name only, no count: this runs in GitHub Actions on a PUBLIC repo, so
    // its log is readable by anyone, and per-table counts (how many users,
    // trades, keys) are information about the business nobody needs there
    // (security gaps pass, 4.5). The total below is enough to see it worked.
    console.log(`  ${table}: done`);
  }

  console.log(`\nDone. ${totalRows} rows across ${dumped} tables.`);

  if (absent.length > 0) {
    // Not a warning to shrug at: if one of these is a table that DOES hold
    // live data, this backup is incomplete and the reason is worth chasing.
    console.log(
      `\n${absent.length} table(s) in scripts/db-tables.ts are not in this database:\n` +
        absent.map((t) => `  ${t}`).join("\n") +
        `\nCheck \`npm run migrations:status\` -- a pending migration explains it.`,
    );
  }

  console.log("");
  await dumpStorage(supabase, outDir);

  console.log("\nNot included: auth.users and schema/policies. See the header of this file and");
  console.log("scripts/restore-db.ts. Screenshots restore with scripts/restore-storage.ts.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
