// Gives the demo account (demo@tradinglens.app) a new random password and
// stores it as DEMO_ACCOUNT_PASSWORD in .env.local. Never prints it.
//
//   node scripts/set-demo-password.mjs           # dry run: says what it would do
//   node scripts/set-demo-password.mjs --apply   # actually change it
//
// Why it exists: until 2026-10-09 the demo password sat as a default in
// scripts/seed-demo-account.mjs, in a public repository, so anyone could sign
// in to the (paid) demo account. Removing it from the file does not undo
// that -- the old value stays in git history forever -- so the password
// itself has to change. Run with --apply once after that commit, and again
// any time the password may have been seen.
//
// To read the new password later, open .env.local in VS Code:
//   code -r -g ".env.local"
// (Ctrl+P hides it because it is gitignored.)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const EMAIL = "demo@tradinglens.app";
const ENV_FILE = new URL("../.env.local", import.meta.url);
const apply = process.argv.includes("--apply");

const envText = readFileSync(ENV_FILE, "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// No process.exit(): on Windows it can trip a libuv assertion while the
// Supabase client's handles are closing. Returning lets Node exit cleanly.
async function main() {
  const { data: list, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const user = list.users.find((u) => u.email?.toLowerCase() === EMAIL);
  if (!user) {
    console.log(`No ${EMAIL} account in this project. Nothing to do.`);
    return;
  }

  if (!apply) {
    console.log(`Would set a new random password on ${EMAIL} (${user.id}) and save it to .env.local.`);
    console.log("Run again with --apply to do it.");
    return;
  }

  // 24 random bytes -> 32 URL-safe characters, plus a fixed tail so any
  // complexity rule (upper, lower, digit, symbol) is always met.
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;

  const { error } = await db.auth.admin.updateUserById(user.id, { password });
  if (error) throw error;

  // Save it where the seed script reads it, replacing any previous value.
  const line = `DEMO_ACCOUNT_PASSWORD=${password}`;
  const next = /^DEMO_ACCOUNT_PASSWORD=.*$/m.test(envText)
    ? envText.replace(/^DEMO_ACCOUNT_PASSWORD=.*$/m, line)
    : `${envText.replace(/\s*$/, "")}\n\n# Demo account password (scripts/set-demo-password.mjs). Never commit.\n${line}\n`;
  writeFileSync(ENV_FILE, next);

  console.log(`Done: ${EMAIL} has a new password, saved as DEMO_ACCOUNT_PASSWORD in .env.local.`);
  console.log("The old password no longer works for new sign-ins.");
  console.log("A password change does not end sessions that are already signed in. To end them too,");
  console.log("run this in the LIVE project's SQL editor:");
  console.log(`  delete from auth.sessions where user_id = '${user.id}';`);
}

await main();
