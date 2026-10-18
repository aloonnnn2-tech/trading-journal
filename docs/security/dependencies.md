# Dependency review (security gaps pass, Phase 4)

Checked 2026-10-18 against the npm registry and download API. "Used in"
comes from searching the code for each package's imports. **Nothing was
removed or upgraded.** Everything under "Proposed" waits for Alon.

## Verdict

No package looks like a typosquat, a newly registered name, or a name an AI
invented. All but one are long-established, widely used packages from their
known publishers. One package is worth a closer look, and one is dead weight:

- **`@gutenye/ocr-node`** (the offline screenshot reader): about 12,000
  downloads a week, **one maintainer**, and native code (ONNX runtime). It is
  legitimate and active (last publish 2026-09-19), but a single-maintainer
  package with native binaries carries the most supply-chain risk in this
  list. Pin the exact version, and read the changelog before each upgrade.
- **`tesseract.js`** (dev): unused. The fallback it served is switched off
  (`src/lib/ocr/engines/index.ts:69-80`), and its dead engine file would
  download a language model at runtime with no integrity check. **Proposed:
  remove it**, with `src/lib/ocr/engines/tesseract.ts`, `scripts/ocr-test.mjs`,
  and its `allowScripts` and `serverExternalPackages` entries.

## Runtime dependencies

| Package | Declared | Latest | First published | Last publish | Weekly downloads | Purpose / used in |
|---|---|---|---|---|---|---|
| @gutenye/ocr-node | ^1.4.8 | 1.4.9 | 2024-05 | 2026-09-19 | ~12k | PaddleOCR (offline screenshot reading): `src/lib/ocr/engines/paddle.ts`, `ocr-worker/` |
| @sentry/nextjs | ^10.70.0 | 11.8.0 | 2021 | 2026-10-15 | ~7M | error monitoring: `instrumentation*.ts`, `next.config.ts` |
| @supabase/ssr | ^0.12.0 | 0.12.7 | 2023 | 2026-09-08 | ~6.4M | cookie sessions: `src/lib/supabase/*`, `src/proxy.ts` |
| @supabase/supabase-js | ^2.108.2 | 2.118.0 | 2020 | 2026-10-15 | ~20M | database, auth, storage: everywhere |
| date-fns | ^4.4.0 | 4.4.0 | 2014 | 2026-05-29 | ~57M | date parsing in **one** file (`src/lib/ocr/normalize.ts`); could be replaced, low priority |
| exceljs | ^4.4.0 | 4.4.0 | 2014 | **2023-10-19** | ~10M | Excel import and export; no release in 3 years (stable, not abandoned-looking at that download level) |
| framer-motion | ^12.42.0 | 14.3.0 | 2019 | 2026-10-15 | ~30M | animation |
| lightweight-charts | ^5.2.0 | 5.2.1 | 2019 | 2026-08-12 | ~0.8M | the trade chart |
| lucide-react | ^1.23.0 | 1.59.0 | 2020 | 2026-10-17 | ~68M | icons |
| next | 16.3.8 | 16.4.2 | 2011 | 2026-10-15 | ~41M | framework |
| next-themes | ^0.4.6 | 0.4.6 | 2020 | 2025-03-11 | ~17M | dark/light mode |
| papaparse | ^5.5.4 | 5.7.0 | 2014 | 2026-08-24 | ~10M | CSV import and export |
| react / react-dom | 19.2.4 | 19.3.1 | 2011 / 2014 | 2026-10-14 | ~110M | UI |
| recharts | ^3.9.0 | 3.10.1 | 2015 | 2026-07-25 | ~34M | charts |
| server-only | ^0.0.1 | 0.0.1 | 2022 | 2022-09-03 | ~14M | build-time guard (a two-line package from the React team, never changes) |
| sharp | ^0.35.5 | 0.35.5 | 2013 | 2026-09-27 | ~70M | image re-encoding |
| zod | ^4.4.3 | 4.6.7 | 2020 | 2026-10-12 | ~213M | validation |

## Dev dependencies

| Package | Declared | Latest | Weekly downloads | Note |
|---|---|---|---|---|
| @netlify/functions | ^5.3.0 | 6.0.2 | ~0.55M | types for the cron function |
| @playwright/test | ^1.63.0 | 1.64.1 | ~46M | e2e |
| @tailwindcss/postcss, tailwindcss | ^4 | 4.3.3 | ~29M / ~85M | CSS |
| @types/node | **^20** | 26.6.5 | ~276M | **mismatch:** the app runs on Node 24 (`.nvmrc`, `engines`). Proposed: `^24` |
| @types/papaparse, @types/react, @types/react-dom | | | | types |
| eslint ^9, eslint-config-next 16.3.8 | | | | lint |
| tesseract.js | ^7.0.0 | 7.0.0 | ~2M | **unused**, see above |
| tsx, typescript, vitest | | | | scripts, types, tests |

`package.json` `overrides` pins nine transitive packages (sharp, nanoid,
adm-zip, brace-expansion, uuid, source-map-js, fast-uri). These are
deliberate security pins, not risks.

## Install scripts (4.2)

Installed packages that run a script when installed:

- `@sentry/cli` (downloads its binary from Sentry's CDN)
- `esbuild`
- `onnxruntime-node` (may contact NuGet)
- `tesseract.js` (`opencollective-postinstall`, unused)
- `unrs-resolver`

The project itself has no install hooks. `package.json` has an
`allowScripts` list naming all five, plus stale `sharp` entries (0.33.5,
0.34.5, 0.35.4). But there is no `.npmrc` setting `strict-allow-scripts`, so
npm only warns about a package that isn't listed; it doesn't refuse it.

**Recommendation (needs Alon's OK, since it changes install behaviour):**
1. Check which npm version CI and Netlify use with Node 24, because an older
   npm ignores `allowScripts`.
2. Add `.npmrc` with `strict-allow-scripts=true`, so a new dependency that
   wants to run code at install fails the install until someone looks at it.
3. Drop the stale `sharp` entries, and `tesseract.js` with the package.

## Lockfile and audit (4.3)

- `package-lock.json` is committed (lockfile v3; every one of the 857
  packages comes from registry.npmjs.org with an integrity hash).
- CI and the backup workflow install with `npm ci`, so builds match the
  lockfile exactly. Netlify's install command is set in its dashboard, not
  the repo: see [netlify-checklist.md](netlify-checklist.md).
- Dependabot is configured (`.github/dependabot.yml`: npm weekly, majors
  grouped, Next/React majors ignored; GitHub Actions too).
- CI downloads gitleaks with a pinned SHA-256 checksum (added in this phase).

`npm audit`, 2026-10-18: 7 findings, **all in development tools; none ship
to users** (`npm audit --omit=dev` in CI passes).

| Package | Severity | Path | Recommendation |
|---|---|---|---|
| braces, micromatch, fast-glob, @next/eslint-plugin-next, eslint-config-next | high (×5) | eslint-config-next's dependency chain (ReDoS-class issues in glob matching) | **Don't apply `npm audit fix --force`**: its "fix" is a downgrade to eslint-config-next 14, which would break linting for Next 16. Wait for eslint-config-next to update the chain (Dependabot will raise it), or override `braces` and `micromatch` to their patched versions after testing lint. They only run on your machine and in CI, on your own code. |
| vitest, @vitest/mocker | moderate (×2) | test runner (file read through a redirect mock) | Upgrade vitest within 4.x when convenient (`npm audit fix` without `--force` covers it). Only runs in tests. |
