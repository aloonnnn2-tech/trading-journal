/**
 * Points this process at the DEV Supabase project, or refuses to run.
 *
 * Runs as a vitest setupFile, so it executes before any app module is
 * imported -- the app reads NEXT_PUBLIC_SUPABASE_URL etc. at call time, and
 * by then they name the dev project.
 *
 * Deliberately does NOT load .env.local into the environment: production's
 * service-role key, encryption secret and cron secret have no business in a
 * process that creates and deletes users. Only the production URL is read
 * from it, as a plain string, so the guard knows what to refuse.
 */
import fs from "node:fs";
import path from "node:path";
import { assertDevSupabase } from "../../src/lib/env/dev-guard";

const root = path.resolve(__dirname, "../..");

function readEnvFile(file: string): Record<string, string> {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const devEnv = { ...readEnvFile(".env.test.local"), ...process.env };
const prodUrl = process.env.SUPABASE_PROD_URL ?? readEnvFile(".env.local").NEXT_PUBLIC_SUPABASE_URL;

export const DEV_HOST = assertDevSupabase(devEnv.SUPABASE_DEV_URL, prodUrl);

for (const name of ["SUPABASE_DEV_ANON_KEY", "SUPABASE_DEV_SERVICE_ROLE_KEY"] as const) {
  if (!devEnv[name]) throw new Error(`${name} is missing from .env.test.local.`);
}

// Origin only: Supabase's Data API page shows the URL with /rest/v1/ on the
// end, and supabase-js appends its own paths to whatever it is given.
process.env.NEXT_PUBLIC_SUPABASE_URL = new URL(devEnv.SUPABASE_DEV_URL!).origin;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = devEnv.SUPABASE_DEV_ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = devEnv.SUPABASE_DEV_SERVICE_ROLE_KEY;
// A throwaway value so modules that check "is encryption configured" load;
// no real key is ever encrypted with it.
process.env.AI_KEY_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString("base64");
delete process.env.AI_KEY_ENCRYPTION_SECRET_PREVIOUS;
delete process.env.CRON_SECRET;
