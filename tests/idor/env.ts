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
 * from it, as a plain string, so the guard knows what to refuse
 * (src/lib/env/dev-project.ts, shared with e2e and the seed scripts).
 */
import path from "node:path";
import { loadDevProject, THROWAWAY_ENCRYPTION_SECRET } from "../../src/lib/env/dev-project";

const dev = loadDevProject(path.resolve(__dirname, "../.."));

export const DEV_HOST = dev.host;

process.env.NEXT_PUBLIC_SUPABASE_URL = dev.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = dev.anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = dev.serviceRoleKey;
process.env.AI_KEY_ENCRYPTION_SECRET = THROWAWAY_ENCRYPTION_SECRET;
delete process.env.AI_KEY_ENCRYPTION_SECRET_PREVIOUS;
delete process.env.CRON_SECRET;
