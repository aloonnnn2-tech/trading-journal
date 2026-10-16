// The environment variables the app cannot work without, checked once and
// named when missing -- instead of failing on the first request that needs
// one, with an error that says something else entirely.

/**
 * Baked into the browser bundle at build time: a build without them ships
 * an app that can't sign anyone in. `next build` stops (next.config.ts).
 */
export const BUILD_REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

/**
 * Read by server code at runtime. Reported when the server starts
 * (src/instrumentation.ts) rather than failing the build: Netlify can scope
 * a secret to functions only, so it may legitimately be absent at build time.
 */
export const RUNTIME_REQUIRED = ["SUPABASE_SERVICE_ROLE_KEY", "AI_KEY_ENCRYPTION_SECRET", "CRON_SECRET"] as const;

export function missingEnv(names: readonly string[], env: Record<string, string | undefined>): string[] {
  return names.filter((name) => !env[name]?.trim());
}

export function missingEnvMessage(missing: string[], where: string): string {
  return `${where}: missing environment variable${missing.length === 1 ? "" : "s"} ${missing.join(", ")}. See .env.local.example.`;
}
