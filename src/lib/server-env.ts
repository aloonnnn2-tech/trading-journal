// Reads a server secret from the environment at RUN time, in a way the
// bundler cannot see at build time.
//
// Turbopack tracks literal `process.env.NAME` reads while compiling and
// records their values in its cache (.next/cache), which Netlify keeps
// between builds -- that is how AI_KEY_ENCRYPTION_SECRET and CRON_SECRET came
// to sit in the build cache (netlify.toml has the history). A lookup by a
// name held in a variable is invisible to that analysis, so the value is
// only ever read by the running server.
//
// Use it for secrets only; ordinary configuration can keep plain reads. Not
// "server-only": the proxy (middleware) uses it via rate-limit.ts, and it
// holds nothing itself -- in a browser it simply finds no value.
export function serverSecret(name: string): string | undefined {
  const env = process.env;
  return env[name];
}
