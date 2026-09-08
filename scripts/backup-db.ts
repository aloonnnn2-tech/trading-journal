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
 * **What this does NOT capture, and it matters when reading a dump as
 * "the backup":**
 *  - Storage objects (trade screenshots) -- binary files behind signed URLs,
 *    not rows in any table here.
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
    console.log(`  ${table}: ${rows.length} rows`);
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

  console.log("\nNot included: trade screenshot images (Supabase Storage), auth.users,");
  console.log("and schema/policies. See the header of this file and scripts/restore-db.ts.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
