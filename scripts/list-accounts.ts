/**
 * Lists every account on the project in .env.local and sorts it into one of
 * four groups, so throwaway test accounts can be found and removed without
 * guessing (hardening brief, final task). READ-ONLY: it calls listUsers and
 * counts rows; there is no flag that makes it write anything.
 *
 *   npm run accounts:list                 masked emails, one line per account
 *   npm run accounts:list -- --json=FILE  also writes ids + group + counts
 *                                         (masked emails) to FILE
 *
 * Groups (src/lib/accounts/classify.ts): keep, test (reserved test domain,
 * a cleanup candidate), check (a person decides), real (never touched).
 *
 * Emails are printed masked ("ab***@domain"), because this output goes into
 * a report in a public repository.
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { accountGroup, maskEmail, type AccountGroup } from "../src/lib/accounts/classify";
import { TABLES } from "./db-tables";


interface Row {
  id: string;
  email: string;
  group: AccountGroup;
  created: string;
  lastSignIn: string | null;
  isAdmin: boolean;
  excluded: boolean;
  plan: string | null;
  rows: Record<string, number>;
  totalRows: number;
  storageFolders: number;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const jsonArg = process.argv.find((a) => a.startsWith("--json="))?.slice("--json=".length);

  const users: { id: string; email?: string; created_at: string; last_sign_in_at?: string | null }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  const { data: settings, error: sErr } = await db
    .from("user_settings")
    .select("user_id, is_admin, excluded_from_analytics, plan");
  if (sErr) throw sErr;
  const settingsBy = new Map(settings.map((s) => [s.user_id as string, s]));

  const out: Row[] = [];
  for (const u of users) {
    const rows: Record<string, number> = {};
    await Promise.all(
      TABLES.map(async (t) => {
        const { count, error } = await db.from(t).select("*", { count: "exact", head: true }).eq("user_id", u.id);
        rows[t] = error ? -1 : (count ?? 0);
      }),
    );
    const { data: files } = await db.storage.from("trade-images").list(u.id, { limit: 1000 });
    const s = settingsBy.get(u.id);
    out.push({
      id: u.id,
      email: maskEmail(u.email),
      group: accountGroup(u.email),
      created: u.created_at.slice(0, 10),
      lastSignIn: u.last_sign_in_at?.slice(0, 10) ?? null,
      isAdmin: Boolean(s?.is_admin),
      excluded: Boolean(s?.excluded_from_analytics),
      plan: (s?.plan as string | undefined) ?? null,
      rows,
      totalRows: Object.values(rows).reduce((a, n) => a + Math.max(n, 0), 0),
      storageFolders: files?.length ?? 0,
    });
  }

  const order: AccountGroup[] = ["keep", "test", "check", "real"];
  out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.created.localeCompare(b.created));
  for (const r of out) {
    const flags = [r.isAdmin && "admin", r.excluded && "excluded", r.plan && `plan=${r.plan}`].filter(Boolean).join(",");
    const busy = Object.entries(r.rows)
      .filter(([, n]) => n !== 0)
      .map(([t, n]) => `${t}=${n}`)
      .join(" ");
    console.log(
      `${r.group.padEnd(5)} ${r.id} ${r.email.padEnd(34)} created ${r.created} last ${r.lastSignIn ?? "never"} [${flags}] rows=${r.totalRows} files=${r.storageFolders} ${busy}`,
    );
  }
  const count = (g: AccountGroup) => out.filter((r) => r.group === g).length;
  console.log(`\n${out.length} accounts: keep ${count("keep")}, test ${count("test")}, check ${count("check")}, real ${count("real")}`);
  if (jsonArg) writeFileSync(jsonArg, JSON.stringify(out, null, 1) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
