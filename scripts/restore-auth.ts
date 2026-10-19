/**
 * Step 0 of restoring a backup into a FRESH project: recreates every account
 * the backup holds, with the SAME id, so the rows' foreign keys into
 * auth.users hold (scripts/restore-db.ts, header point 1). Security gaps
 * pass, Phase 6; the drill that uses it is docs/security/restore-test.md.
 *
 *   npx tsx --env-file=<target env file> scripts/restore-auth.ts --dir backups/<stamp>
 *   ... --apply                               # actually create
 *
 * Since 2026-10-19 the backup holds the account list (auth_users.json:
 * id, email, sign-up and sign-in dates, sign-in methods; Alon's decision,
 * gaps report Q13). Each account comes back with its real email and no
 * password: people get back in with "Forgot password" (or Google, which
 * Supabase links to the same address). Nobody is emailed by this script.
 *
 * An account that has rows but isn't in auth_users.json (a backup from
 * before that date) gets a placeholder address,
 * restored-<id>@example.invalid, which can't receive mail or sign in:
 * enough to restore and check the data. --placeholders forces that for
 * every account.
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

export const AUTH_USERS_FILE = "auth_users.json";

export interface BackupAccount {
  id: string;
  /** Null when the backup has rows for this id but no account entry. */
  email: string | null;
  confirmed: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every account in the dump: the account list, plus any user_id a row names. */
export function accountsInBackup(dir: string): BackupAccount[] {
  const accounts = new Map<string, BackupAccount>();
  const listFile = path.join(dir, AUTH_USERS_FILE);
  if (existsSync(listFile)) {
    const list: unknown = JSON.parse(readFileSync(listFile, "utf8"));
    for (const u of Array.isArray(list) ? list : []) {
      const { id, email, email_confirmed_at } = (u ?? {}) as { id?: unknown; email?: unknown; email_confirmed_at?: unknown };
      if (typeof id !== "string" || !UUID.test(id)) continue;
      accounts.set(id.toLowerCase(), {
        id: id.toLowerCase(),
        email: typeof email === "string" && email.includes("@") ? email : null,
        confirmed: typeof email_confirmed_at === "string",
      });
    }
  }
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== AUTH_USERS_FILE)) {
    const rows: unknown = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const id = (row as { user_id?: unknown } | null)?.user_id;
      if (typeof id === "string" && UUID.test(id) && !accounts.has(id.toLowerCase())) {
        accounts.set(id.toLowerCase(), { id: id.toLowerCase(), email: null, confirmed: false });
      }
    }
  }
  return [...accounts.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const dirIndex = argv.indexOf("--dir");
  const dir = dirIndex !== -1 ? argv[dirIndex + 1] : null;
  const apply = argv.includes("--apply");
  const allowExisting = argv.includes("--allow-existing");
  const placeholders = argv.includes("--placeholders");
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
  // for recreated accounts, whatever env file was passed.
  const localEnv = path.join(process.cwd(), ".env.local");
  const liveUrl = existsSync(localEnv) ? readEnvFile(localEnv).NEXT_PUBLIC_SUPABASE_URL : undefined;
  if (liveUrl && new URL(liveUrl).host === new URL(url).host) {
    console.error("Refusing: the target is the project in .env.local (live). Pass the restore target's env file.");
    return 2;
  }

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const accounts = accountsInBackup(dir);
  const withEmail = placeholders ? 0 : accounts.filter((a) => a.email).length;
  console.log(`Backup: ${path.resolve(dir)}`);
  console.log(`Target: ${url}`);
  console.log(apply ? "Mode:   APPLY (will create accounts)\n" : "Mode:   dry run (no writes)\n");
  console.log(`${accounts.length} account(s) in the backup: ${withEmail} with their email, ${accounts.length - withEmail} as placeholders.`);

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
  const missing = accounts.filter((a) => !existing.has(a.id));
  console.log(`${missing.length} to create, ${accounts.length - missing.length} already there.`);
  if (!apply) {
    console.log("\nDry run only -- nothing was written. Add --apply to create them.");
    return 0;
  }

  for (const account of missing) {
    const real = !placeholders && account.email;
    const { error } = await db.auth.admin.createUser({
      id: account.id,
      email: real ? account.email! : `restored-${account.id}@example.invalid`,
      // A real address keeps its confirmed state; no email is sent either way.
      email_confirm: real ? account.confirmed : true,
      user_metadata: { restored_from_backup: true },
    });
    if (error) throw new Error(`${account.id}: ${error.message}`);
    // The sign-up trigger's default fields: the backup brings this account's own.
    const { error: seedError } = await db.from("field_definitions").delete().eq("user_id", account.id);
    if (seedError) throw new Error(`${account.id}: could not clear the seeded fields -- ${seedError.message}`);
  }
  console.log(`\nCreated ${missing.length}. Next: scripts/restore-db.ts --dir ${dir} (dry run, then --apply).`);
  return 0;
}

if (process.argv[1]?.includes("restore-auth")) {
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
