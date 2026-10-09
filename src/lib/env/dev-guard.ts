/**
 * The one check that stands between a test or seed script and the live
 * database. Tests, seeds and e2e create and delete users; pointed at the
 * production project they would do that to real accounts (security
 * hardening, final task: "tests must never hit the live DB").
 *
 * Fails CLOSED: a missing or unparseable URL is an error, and so is not
 * knowing what production is -- "can't tell" must never mean "go ahead".
 */

export class DevGuardError extends Error {}

function hostOf(url: string | undefined, label: string): string {
  if (!url) throw new DevGuardError(`${label} is not set.`);
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    throw new DevGuardError(`${label} is not a valid URL.`);
  }
  return host;
}

/**
 * Throws unless `devUrl` is a Supabase project that is NOT `prodUrl`.
 * Returns the dev host on success.
 */
export function assertDevSupabase(devUrl: string | undefined, prodUrl: string | undefined): string {
  const dev = hostOf(devUrl, "SUPABASE_DEV_URL");
  const prod = hostOf(prodUrl, "The production Supabase URL (NEXT_PUBLIC_SUPABASE_URL in .env.local)");
  if (!dev.endsWith(".supabase.co")) {
    throw new DevGuardError(`SUPABASE_DEV_URL must be a *.supabase.co project, got ${dev}.`);
  }
  if (dev === prod) {
    throw new DevGuardError(
      "SUPABASE_DEV_URL points at the PRODUCTION project. Refusing to run -- " +
        "tests and seed scripts create and delete users. Use the dev project's URL.",
    );
  }
  return dev;
}
