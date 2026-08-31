// Fails if a server-only secret has been compiled into the browser bundle.
//
// `import "server-only"` (see src/lib/supabase/admin.ts and
// src/lib/ai-keys/crypto.ts) already turns the usual mistake -- a client
// component importing a module that holds a secret -- into a build error.
// This check covers what that cannot: a NEW secret read straight out of
// process.env inside a client component, which Next would happily inline with
// no module boundary to trip the guard.
//
// It reads the *built output*, not the source, because that is the only thing
// that proves what actually ships. Run `next build` first.
//
// Usage: npm run check:bundle
//
// Secret VALUES are never printed -- only variable names and a verdict -- so
// this is safe to run in CI and paste into a bug report.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Everything served to a browser lands here. .next/server is deliberately not
// scanned: secrets are legitimately present in server code at runtime.
const CLIENT_DIR = ".next/static";

// Anything NEXT_PUBLIC_ is public by definition and intentionally inlined, so
// the rule is simply: every env var without that prefix must be absent.
const PUBLIC_PREFIX = "NEXT_PUBLIC_";

// Short values would collide with ordinary bundle text and produce false
// alarms; real credentials are far longer than this.
const MIN_SECRET_LENGTH = 12;

// Not credentials, and Sentry's build plugin embeds them in the client bundle
// on purpose: the DSN is the address the browser SDK reports errors to (it is
// meant to be public, and is duplicated here as NEXT_PUBLIC_SENTRY_DSN), while
// org and project are build metadata used to tag releases. Listed explicitly
// rather than filtered by some heuristic, because the point of this check is
// that a hit means something -- one false alarm and nobody reads the output
// again. SENTRY_AUTH_TOKEN is deliberately NOT here: that one is a real
// credential and must never ship.
const PUBLIC_BY_DESIGN = new Set(["SENTRY_DSN", "SENTRY_ORG", "SENTRY_PROJECT"]);

function loadEnv(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value) env[match[1]] = value;
  }
  return env;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const env = loadEnv(".env.local");
// A var whose value is byte-identical to some NEXT_PUBLIC_ var is that public
// value under a second name -- finding it in the bundle proves nothing about
// the private one, so checking it can only ever produce a false alarm.
const publicValues = new Set(
  Object.entries(env)
    .filter(([name]) => name.startsWith(PUBLIC_PREFIX))
    .map(([, value]) => value),
);

const secrets = Object.entries(env).filter(
  ([name, value]) =>
    !name.startsWith(PUBLIC_PREFIX) &&
    !PUBLIC_BY_DESIGN.has(name) &&
    !publicValues.has(value) &&
    value.length >= MIN_SECRET_LENGTH,
);

if (secrets.length === 0) {
  console.error("No secrets found in .env.local -- nothing to check. Is the file present?");
  process.exit(1);
}

const files = walk(CLIENT_DIR);
if (files.length === 0) {
  console.error(`${CLIENT_DIR} is empty or missing. Run \`npm run build\` first.`);
  process.exit(1);
}

// latin1 keeps every byte addressable regardless of the file's real encoding,
// so a secret can't hide behind a decoding failure.
const blobs = files.map((file) => ({ file, text: readFileSync(file, "latin1") }));

console.log(`Scanning ${files.length} files in ${CLIENT_DIR} for ${secrets.length} server-only secrets\n`);

let leaked = 0;
for (const [name, value] of secrets) {
  const hits = blobs.filter((b) => b.text.includes(value)).map((b) => b.file);
  if (hits.length > 0) {
    leaked++;
    console.error(`  LEAKED  ${name} appears in: ${hits.join(", ")}`);
  } else {
    console.log(`  ok      ${name}`);
  }
}

if (leaked > 0) {
  console.error(
    `\n${leaked} server-only secret(s) are in the browser bundle. Treat them as compromised: ` +
      `rotate them, then find the client component reading them from process.env.`,
  );
  process.exit(1);
}

console.log("\nNo server-only secret is in the browser bundle.");
