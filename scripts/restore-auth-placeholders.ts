/**
 * Step 0 of restoring a backup into a FRESH project: recreates every account
 * the backup's rows belong to, with the SAME id, so their foreign keys into
 * auth.users hold (scripts/restore-db.ts, header point 1). Security gaps
 * pass, Phase 6; the drill that uses it is docs/security/restore-test.md.
 *
 *   npx tsx --env-file=<target env file> scripts/restore-auth-placeholders.ts --dir backups/<stamp>
 *   ... --apply                               # actually create
 *
 * The backup holds no emails (auth.users isn't in it), so each account gets
 * a placeholder address, restored-<id>@example.invalid, which can't receive
 * mail and can't sign in. That is enough to restore and check the data. Real
 * people getting their accounts back needs their addresses: an open question
 * (02-gaps-report.md, Q13).
 *
 * Creating a user fires the sign-up triggers (0002/0034, 0003/0061), which
 * seed default custom fields and settings with NEW ids. The restored rows
 * would then clash with those defaults on (user_id, entity_type, key), so
 * the seeded fields are deleted again here; the backup's own copies replace
 * them. Settings are keyed by user id and simply overwritten by the restore.
 *
 * Refuses the live project (the one .env.local names) outright, and any
 * target that already has accounts unless --allow-existing: a fresh project
 * has none.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readEnvFile } from "../src/lib/env/dev-project";

export function userIdsInBackup(dir: string): string[] {
  const ids = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const rows: unknown = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const id = (row as { user_id?: unknown } | null)?.user_id;
      if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) ids.add(id.toLowerCase());
    }
  }
  return [...ids].sort();
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const dirIndex = argv.indexOf("--dir");
  const dir = dirIndex !== -1 ? argv[dirIndex + 1] : null;
  const apply = argv.includes("--apply");
  const allowExisting = argv.includes("--allow-existing");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (pass the target's env file).");
    return 2;
  }
  if (!dir || !existsSync(dir)) {
    console.error("Pass --dir backups/<stamp>.");
    return 2;
  }

  // The live project (the one .env.local names) is never a restore target
  // for placeholder accounts, whatever env file was passed.
  const localEnv = path.join(process.cwd(), ".env.local");
  const liveUrl = existsSync(localEnv) ? readEnvFile(localEnv).NEXT_PUBLIC_SUPABASE_URL : undefined;
  if (liveUrl && new URL(liveUrl).host === new URL(url).host) {
    console.error("Refusing: the target is the project in .env.local (live). Pass the throwaway project's env file.");
    return 2;
  }

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const ids = userIdsInBackup(dir);
  console.log(`Backup: ${path.resolve(dir)}`);
  console.log(`Target: ${url}`);
  console.log(apply ? "Mode:   APPLY (will create accounts)\n" : "Mode:   dry run (no writes)\n");
  console.log(`${ids.length} account(s) in the backup.`);

  const { data: page, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const existing = new Set(page.users.map((u) => u.id));
  if (existing.size > 0 && !allowExisting) {
    console.error(
      `\nThe target already has ${existing.size} account(s). A fresh project has none, so this refuses.` +
        "\nIf this really is the restore target, re-run with --allow-existing (existing ids are skipped).",
    );
    return 2;
  }
  const missing = ids.filter((id) => !existing.has(id));
  console.log(`${missing.length} to create, ${ids.length - missing.length} already there.`);
  if (!apply) {
    console.log("\nDry run only -- nothing was written. Add --apply to create them.");
    return 0;
  }

  for (const id of missing) {
    const { error } = await db.auth.admin.createUser({
      id,
      email: `restored-${id}@example.invalid`,
      email_confirm: true,
      user_metadata: { restored_placeholder: true },
    });
    if (error) throw new Error(`${id}: ${error.message}`);
    // The sign-up trigger's default fields: the backup brings this account's own.
    const { error: seedError } = await db.from("field_definitions").delete().eq("user_id", id);
    if (seedError) throw new Error(`${id}: could not clear the seeded fields -- ${seedError.message}`);
  }
  console.log(`\nCreated ${missing.length}. Next: scripts/restore-db.ts --dir ${dir} (dry run, then --apply).`);
  return 0;
}

if (process.argv[1]?.includes("restore-auth-placeholders")) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
