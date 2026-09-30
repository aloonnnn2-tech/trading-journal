// Reports which build-cache and build-output files contain the value of a
// server secret. Prints file paths and counts only -- never the secret.
//
//   npx tsx --env-file=.env.local scripts/check-cache-secrets.ts
//
// Turbopack records the environment it compiled with in .next/cache, and
// Netlify keeps that cache between builds (see netlify.toml). This is how to
// see whether a secret still lands there.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const NAMES = ["AI_KEY_ENCRYPTION_SECRET", "AI_KEY_ENCRYPTION_SECRET_PREVIOUS", "CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY"];

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out = out.concat(walk(path));
    else if (st.size < 200 * 1024 * 1024) out.push(path);
  }
  return out;
}

const files = walk(".next");
let total = 0;
for (const name of NAMES) {
  const value = process.env[name];
  if (!value || value.length < 12) continue;
  const needle = Buffer.from(value, "utf8");
  const hits = files.filter((f) => readFileSync(f).includes(needle));
  total += hits.length;
  console.log(`${name}: ${hits.length} file(s)`);
  for (const h of hits.slice(0, 10)) console.log(`  ${h}`);
}
process.exitCode = total > 0 ? 1 : 0;
