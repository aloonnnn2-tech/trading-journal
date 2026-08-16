/**
 * Manual, on-demand backup of every user-data table to local JSON.
 *
 * Supabase's free plan has no automated backups (confirmed via the
 * Management API: pitr_enabled: false, zero stored backups) and the project
 * is staying on the free plan, so this is the only recovery path if
 * something goes wrong -- run it by hand before risky changes (migrations,
 * bulk edits) and periodically otherwise.
 *
 * Uses the service-role key to bypass RLS, so it captures every user's data
 * in one pass, not just one account's.
 *
 * Does NOT back up Storage objects (trade screenshots) -- those are binary
 * files behind signed URLs, not rows in these tables. A gap, but the trade
 * data itself (the part that can't be re-uploaded) is what this covers.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/backup-db.ts
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const TABLES = [
  "trades",
  "trade_history",
  "trade_images",
  "trade_folders",
  "trade_strategies",
  "folders",
  "strategies",
  "commission_rules",
  "field_definitions",
  "user_settings",
  "account_transactions",
  "analytics_events",
  "analytics_sessions",
] as const;

// PostgREST caps any single response at 1,000 rows regardless of .limit() --
// this codebase has hit that exact bug in the app itself more than once, so
// paginate explicitly rather than repeat it here.
const PAGE_SIZE = 1000;

async function dumpTable(
  supabase: ReturnType<typeof createClient>,
  table: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`${table}: ${error.message}`);
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
  for (const table of TABLES) {
    const rows = await dumpTable(supabase, table);
    writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(rows, null, 2));
    totalRows += rows.length;
    console.log(`  ${table}: ${rows.length} rows`);
  }

  console.log(`\nDone. ${totalRows} rows across ${TABLES.length} tables.`);
  console.log("Note: trade screenshot images (Supabase Storage) are not included.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
