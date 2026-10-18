/**
 * Counts accounts by state, with no emails and no ids (security gaps pass,
 * 5.5): how many are confirmed, how many never confirmed and how old they
 * are, how many have never signed in, and how many sign in with each method.
 * READ-ONLY: listUsers only. Safe to paste into a report or a public issue.
 *
 *   npm run accounts:summary
 *
 * For one line per account (masked emails), use npm run accounts:list.
 */
import { createClient, type User } from "@supabase/supabase-js";

const DAY = 24 * 60 * 60 * 1000;

export function summarise(users: User[], now = Date.now()) {
  const out = {
    total: users.length,
    confirmed: 0,
    unconfirmed: 0,
    unconfirmedOlderThan7Days: 0,
    unconfirmedOlderThan30Days: 0,
    neverSignedIn: 0,
    signedInLast30Days: 0,
    byMethod: {} as Record<string, number>,
  };
  for (const u of users) {
    if (u.email_confirmed_at) out.confirmed++;
    else {
      out.unconfirmed++;
      const age = now - Date.parse(u.created_at);
      if (age > 7 * DAY) out.unconfirmedOlderThan7Days++;
      if (age > 30 * DAY) out.unconfirmedOlderThan30Days++;
    }
    if (!u.last_sign_in_at) out.neverSignedIn++;
    else if (now - Date.parse(u.last_sign_in_at) <= 30 * DAY) out.signedInLast30Days++;
    const providers = (u.app_metadata as { providers?: unknown }).providers;
    for (const p of Array.isArray(providers) ? providers : ["unknown"]) {
      out.byMethod[String(p)] = (out.byMethod[String(p)] ?? 0) + 1;
    }
  }
  return out;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).");
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  console.log(`Project: ${new URL(url).hostname.split(".")[0].slice(0, 4)}…`);
  console.log(JSON.stringify(summarise(users), null, 2));
}

if (process.argv[1]?.includes("accounts-summary")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
