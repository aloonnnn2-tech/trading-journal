import fs from "node:fs";
import path from "node:path";
import { assertDevSupabase } from "./dev-guard";

/**
 * The DEV Supabase project's connection details, for anything that creates
 * accounts: the cross-user tests, e2e and the fake-data seed. Throws unless
 * they name a project that is not production (dev-guard.ts), so "tests never
 * touch the live database" is enforced in code, not remembered.
 *
 * Read from `.env.test.local` (or the environment). Production's URL is read
 * from `.env.local` only to know what to refuse; no other production value
 * is loaded. Node-only: never import this from app code.
 */
export interface DevProject {
  /** Origin only (the dashboard shows it with /rest/v1/ on the end). */
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  host: string;
}

export function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function loadDevProject(root: string): DevProject {
  const env = { ...readEnvFile(path.join(root, ".env.test.local")), ...process.env };
  const prodUrl = process.env.SUPABASE_PROD_URL ?? readEnvFile(path.join(root, ".env.local")).NEXT_PUBLIC_SUPABASE_URL;
  const host = assertDevSupabase(env.SUPABASE_DEV_URL, prodUrl);
  for (const name of ["SUPABASE_DEV_ANON_KEY", "SUPABASE_DEV_SERVICE_ROLE_KEY"] as const) {
    if (!env[name]) throw new Error(`${name} is missing from .env.test.local (see docs/dev-accounts.md).`);
  }
  return {
    url: new URL(env.SUPABASE_DEV_URL!).origin,
    anonKey: env.SUPABASE_DEV_ANON_KEY!,
    serviceRoleKey: env.SUPABASE_DEV_SERVICE_ROLE_KEY!,
    host,
  };
}

/** A fixed throwaway encryption secret for processes pointed at the dev
 *  project: modules that check "is encryption configured" load, and no
 *  real key is ever encrypted with it. */
export const THROWAWAY_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString("base64");

// Cloudflare's always-pass test keys: the widget hands over a dummy token,
// which the dev project (no CAPTCHA) ignores and our own check accepts.
export { TURNSTILE_TEST_SECRET, TURNSTILE_TEST_SITEKEY } from "./turnstile-test-keys";
import { TURNSTILE_TEST_SECRET, TURNSTILE_TEST_SITEKEY } from "./turnstile-test-keys";

/**
 * Environment for a `next dev` that talks to the dev project. Values already
 * in process.env win over .env.local in Next, so these replace production's
 * for that server; the rest of .env.local still loads.
 */
export function devServerEnv(dev: DevProject): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: dev.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: dev.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: dev.serviceRoleKey,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITEKEY,
    TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
    AI_KEY_ENCRYPTION_SECRET: THROWAWAY_ENCRYPTION_SECRET,
  };
}
