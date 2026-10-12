// Reports which build-cache and build-output files contain the value of a
// server secret. Prints file paths and counts only -- never the secret.
//
//   npm run check:cache-secrets      (after `npm run build`)
//
// Turbopack's persistent build cache recorded the whole build environment in
// .next/cache, and Netlify keeps that cache between builds (see netlify.toml).
// It is switched off in next.config.ts; this proves it stays that way.

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

// .next/dev is `next dev`'s own cache (Next 16 keeps it apart from the build).
// It holds secrets too -- the dev server's environment -- but it only exists
// on a developer's disk next to .env.local, which holds the same values.
// Netlify never runs `next dev`, so nothing there is built, cached by the
// platform, or deployed. This check is about what the BUILD leaves behind.
const files = walk(".next").filter((f) => !/(^|[\\/])\.next[\\/]dev[\\/]/.test(f));
console.log("(skipping .next/dev: local dev-server cache, never deployed)");
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
