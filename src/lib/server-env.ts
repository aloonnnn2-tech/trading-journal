// Reads a server secret from the environment at RUN time, by a name held in
// a variable, so no build step can ever inline its value into compiled code.
//
// This is NOT what keeps secrets out of the build cache: Turbopack's
// persistent build cache recorded the entire process environment no matter
// how the code read it. That cache is switched off in next.config.ts
// (turbopackFileSystemCacheForBuild), and `npm run check:cache-secrets`
// verifies it after a build.
//
// Use it for secrets only; ordinary configuration can keep plain reads. Not
// "server-only": the proxy (middleware) uses it via rate-limit.ts, and it
// holds nothing itself -- in a browser it simply finds no value.
export function serverSecret(name: string): string | undefined {
  const env = process.env;
  return env[name];
}
