/**
 * The security regression suite, in one place (security gaps pass, 7.1).
 *
 *   npm run test:security        these, from anywhere in the repo (no network)
 *   npm run test:security:all    these + the cross-user suite on the DEV project
 *
 * The tests stay next to the code they guard (moving them would break the
 * "test beside its module" layout everything else follows); this file is
 * the index. src/lib/security-suite.test.ts fails if a path here stops
 * existing, or if a file named *.security.test.ts, *.enumeration.test.ts or
 * *.drift.test.ts isn't listed -- so naming a new test that way is not enough
 * on its own, it has to be added here too.
 *
 * Every one of these also runs in the normal `npx vitest run`; this is the
 * subset to run, and to show in CI, on its own.
 */
export const SECURITY_SUITE: Record<string, string[]> = {
  // Who may see or change what. The route-level checks are here; the full
  // cross-user proof (two real accounts, every table and route) is
  // tests/idor, run by test:security:all.
  "access and sessions": [
    "src/proxy.test.ts",
    "src/app/admin/admin-gates.test.ts",
    "src/app/api/admin/waitlist/route.test.ts",
    "src/app/api/admin/reviews/[id]/route.test.ts",
    "src/lib/auth/roles.test.ts",
    "src/lib/auth/next-path.test.ts",
    "src/lib/auth/confirm-link.test.ts",
    "src/lib/auth/oauth-providers.test.ts",
  ],
  "account enumeration": [
    "src/lib/auth/error-messages.test.ts",
    "src/app/forgot-password/forgot-password.enumeration.test.ts",
  ],
  "rate limits and quotas": [
    "src/lib/rate-limit.test.ts",
    "src/lib/rate-limits/daily.test.ts",
    "src/lib/http/body-limits.test.ts",
    "src/lib/limits.test.ts",
    "src/lib/images/quota.test.ts",
    "src/lib/trades/create-limits.test.ts",
    "src/app/api/trades/[id]/images/route.test.ts",
    "src/app/api/folders/route.test.ts",
  ],
  // Requests our server makes on a user's behalf.
  "SSRF and outbound requests": [
    "src/lib/market-data/yahoo.test.ts",
    "src/lib/ai-keys/providers/fixed-hosts.security.test.ts",
    "src/lib/http/resilient-fetch.test.ts",
  ],
  "XSS and injection": [
    "src/proxy.csp.security.test.ts",
    "src/app/ask/answer-text.test.ts",
    "src/lib/trades/schema.test.ts",
    "src/lib/images/magic.test.ts",
    "src/lib/trades/export.security.test.ts",
    "src/lib/trades/export.xlsx.security.test.ts",
    "src/lib/ocr/preprocess.security.test.ts",
  ],
  "error and secret leaks": [
    "src/lib/api/server-error.test.ts",
    "src/lib/observability/scrub.test.ts",
    "src/lib/observability/log.test.ts",
    "src/lib/ai-keys/crypto.test.ts",
    "src/lib/ai-keys/secret.test.ts",
    "src/lib/ai-keys/vault.test.ts",
    "src/lib/env/required.test.ts",
  ],
  // The demo account is deliberately writable (Alon, 2026-10-18: G-9
  // accepted), so there are no write restrictions to test; these cover the
  // demo flow's own guards.
  "demo account": ["src/app/api/demo/route.test.ts"],
  "never touch live from tests and scripts": [
    "src/lib/env/dev-guard.test.ts",
    "src/lib/env/dev-project.test.ts",
    "src/lib/env/account-creators.test.ts",
  ],
  "account lifecycle and audit": [
    "src/app/api/account/delete/route.test.ts",
    "src/lib/account/delete-account.test.ts",
    "src/lib/account/data-export.test.ts",
    "src/lib/account/auth-profile.test.ts",
    "src/lib/admin/audit.test.ts",
  ],
  "backups and recovery": [
    "src/lib/backup/db-tables.drift.test.ts",
    "src/lib/backup/restore-auth-placeholders.test.ts",
  ],
  "this index": ["src/lib/security-suite.test.ts"],
};

export const SECURITY_TEST_FILES: string[] = Object.values(SECURITY_SUITE).flat();
