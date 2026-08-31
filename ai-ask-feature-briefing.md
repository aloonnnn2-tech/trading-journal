# Paid AI "Ask Your Journal" (Bring-Your-Own-Key)

## Goal

Replace the existing free, rule-based "Ask Your Journal" page (`/ask`) with a
paid-plan-only feature: users on the paid plan can add their own AI provider
API key (OpenAI, Anthropic, or Google) and ask free-text questions about
their own trading journal data. The AI calls run on the user's own key, so
this feature costs the app nothing to operate.

This also requires adding a minimal paid/free plan flag to the app, since
none exists yet — see Scope below.

**Assumption stated up front (confirm before/while implementing):** the old
deterministic "no AI, no API key, just math" version of `/ask`
(`src/app/ask/page.tsx`, `src/lib/ask/queries.ts`, its category cards) is
being **removed entirely**, not kept alongside the new feature. The `/ask`
route and its nav entry stay, but the page's content and behavior change
completely. If that's not what was meant, stop and flag it rather than
guessing further.

## Context

**Stack:** Next.js 16 App Router + React 19 (`src/app/`), Tailwind CSS 4,
Supabase Postgres (`supabase/migrations/`, client helpers in
`src/lib/supabase/`), no separate backend — API routes live in
`src/app/api/**/route.ts`. Business logic is organized by domain under
`src/lib/<domain>/` (`queries.ts`, `schema.ts`, `types.ts`). Tests are
colocated `*.test.ts` files run with `vitest`.

**Existing `/ask` page today:** `src/app/ask/page.tsx` renders fixed
"answers" (best day of week, best strategy, emotion vs. win-rate, etc.)
computed purely from SQL aggregates in `src/lib/ask/queries.ts` — no AI, no
external calls, no user-configurable anything. This whole implementation is
being replaced.

**No billing/plan system exists yet.** There is no Stripe integration, no
`plan`/`subscription`/`tier` column anywhere in the schema or code. This doc
includes adding the minimal flag needed to gate this one feature — it does
**not** include building checkout/payment collection (see Non-goals).

**Conventions this codebase follows consistently — match them:**

- **Auth in routes:** `getUserIdFromHeader()` (from `src/lib/supabase/auth.ts`)
  in API routes, returning `401` if `null`. `requireUserId()` in server
  components, which redirects to `/sign-in`. See
  `src/app/api/strategies/route.ts` and `src/app/ask/page.tsx` for the exact
  pattern.
- **DB access:** `createClient()` (`src/lib/supabase/server.ts`) is the
  RLS-scoped client — use it for essentially everything. `createAdminClient()`
  (`src/lib/supabase/admin.ts`) bypasses RLS entirely and is reserved for
  operations that genuinely need it (service-role-only tasks); if used, every
  query must filter by `user_id` explicitly and say why in a comment, per the
  warning already written at the top of that file.
- **Validation:** a `schema.ts` per domain built with `zod`, e.g.
  `src/lib/strategies/schema.ts` — bounded strings, explicit error messages,
  separate create/patch schemas where relevant.
- **Migrations:** numbered sequentially in `supabase/migrations/` (next is
  `0029`), each starting with a `-- MANUAL APPLY REQUIRED: paste this file
  into the Supabase SQL editor and run it.` comment (there is no CLI /
  service-role migration runner in this project — see any existing file, e.g.
  `0022_commissions.sql`). RLS policies use the same shape everywhere:
  ```sql
  alter table <table> enable row level security;
  create policy "<table> owner access"
    on <table> for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  ```
  Reuse the existing `set_updated_at()` trigger function for any
  `updated_at` column (see `0003_user_settings.sql`, `0022_commissions.sql`).
- **Rate limiting:** `src/lib/rate-limit.ts` is a small in-memory
  sliding-window limiter, already used on the OCR route. Reuse it rather than
  adding a dependency.
- **Comment style:** this codebase writes detailed "why, not what" comments
  wherever a decision isn't obvious from the code alone — especially around
  security, RLS, and data correctness (nearly every file above has an
  example). Match that density in new code, particularly the encryption and
  masking logic below.
- **Env vars:** documented in `.env.local.example` with a comment explaining
  what they're for and whether they're server-only (see
  `SUPABASE_SERVICE_ROLE_KEY`'s comment: "Server-only... Never expose to the
  client / never prefix with `NEXT_PUBLIC_`.").

## Scope

### In scope

1. **Minimal paid-plan flag.**
   - Add a `plan` column to `user_settings`: `text not null default 'free'
     check (plan in ('free', 'paid'))`.
   - Add `plan` to the `UserSettings` interface and `getUserSettings()` in
     `src/lib/settings/queries.ts` (default `'free'` in `DEFAULT_SETTINGS`).
   - Add a small helper, e.g. `isPaidUser(settings: UserSettings): boolean`
     in `src/lib/settings/`, and use it everywhere this feature needs to gate
     access. This is a flag only — nothing in this doc flips it automatically
     from a real payment; see Non-goals.

2. **API key storage.**
   - New table `user_api_keys`: `id uuid pk default gen_random_uuid()`,
     `user_id uuid not null references auth.users(id) on delete cascade`,
     `provider text not null check (provider in ('openai', 'anthropic',
     'google'))`, `label text` (optional user nickname), `encrypted_key text
     not null`, `last_four text not null` (for masked display, e.g. `•••• 4a2f`),
     `is_active boolean not null default true`, `last_validated_at
     timestamptz`, `created_at`/`updated_at timestamptz not null default
     now()`. RLS: owner-only, same `for all using/with check (auth.uid() =
     user_id)` pattern as every other per-user table in this schema.
   - `src/lib/ai-keys/crypto.ts`: `encrypt(plaintext: string): string` /
     `decrypt(ciphertext: string): string` using AES-256-GCM, keyed by a new
     **server-only** env var (e.g. `AI_KEY_ENCRYPTION_SECRET`, a 32-byte key).
     Add it to `.env.local.example` with a comment matching
     `SUPABASE_SERVICE_ROLE_KEY`'s style. Never import this module from
     anything bundled to the client.
   - Keys are encrypted before insert and only decrypted server-side, inside
     the route that's about to call the provider — never sent back to the
     client after creation. Any endpoint that lists keys returns only
     `provider`, `label`, `last_four`, `is_active`, `created_at` — never the
     decrypted value.

3. **Key management API.**
   - `GET /api/ai-keys` — list the caller's keys (masked, as above).
   - `POST /api/ai-keys` — body `{ provider, key, label? }`, validated with a
     zod schema. Before saving, test-call the provider with a minimal request
     (see `validateKey` below) to confirm the key actually works; on failure,
     return `400` with a clear message and don't save anything.
   - `DELETE /api/ai-keys/[id]` — removes a key; verify it belongs to the
     caller first (404 otherwise, not 403 — don't confirm other users' key
     ids exist).
   - Every one of these: `401` unauthenticated, `403` if `!isPaidUser(...)`
     with a message like "Upgrade to the paid plan to use this feature."

4. **Provider abstraction.**
   - `src/lib/ai-keys/providers/types.ts` — a shared interface, roughly:
     ```ts
     interface AIProvider {
       name: "openai" | "anthropic" | "google";
       validateKey(apiKey: string): Promise<boolean>;
       askQuestion(apiKey: string, systemPrompt: string, question: string): Promise<string>;
     }
     ```
   - `openai.ts`, `anthropic.ts`, `google.ts` each implement it. Prefer plain
     `fetch()` against each provider's REST API over adding three SDK
     dependencies, the way `src/lib/market-data/yahoo.ts` integrates an
     external API without one — but if a provider's raw REST API is
     meaningfully harder to get right than its official SDK, adding that one
     SDK is fine. Use judgment.
   - `validateKey` should be a cheap call (e.g. a minimal/near-zero-token
     request or a lightweight "list models" endpoint if the provider has
     one) — it's what powers the "test before save" step above.

5. **Ask endpoint.**
   - `POST /api/ask-ai` — body identifies which saved key to use (e.g.
     `{ question, keyId }`). `401`/`403` as above, `400` on invalid body or
     no matching active key. Rate-limit per user via the existing
     `rateLimit()` helper (e.g. keyed `ask-ai:<userId>`) — even though the
     AI cost sits on the user's own key, this route still does DB reads and
     proxies external calls, so it needs the same abuse guard as OCR.
   - Builds a context from the **requesting user's own trade data only**
     (RLS already scopes reads to the caller when using `createClient()` —
     don't bypass that). **Exact retrieval/summarization approach is your
     call** — pick whatever gives relevant, accurate answers. The only hard
     constraints: keep it token-conscious (this is the user's own key/quota,
     but a bloated prompt is still a bad experience and can blow small
     context windows), and don't indiscriminately dump every raw free-text
     trade note into the prompt unfiltered — summarize or bound it.
   - Decrypts the selected key, calls the matching provider's `askQuestion`,
     returns `{ answer }`. On provider failure, distinguish in the response
     between "your API key was rejected," "the provider is unavailable," and
     a generic fallback — don't leak raw provider error bodies/stack traces
     to the client; log the detail server-side instead.

6. **`/ask` page rewrite** (`src/app/ask/page.tsx`, plus whatever client
   components it composes — follow this repo's usual page.tsx-composes-a-
   client-component shape, e.g. `strategy-manager.tsx` /
   `commission-manager.tsx`). Three states:
   - **Free plan:** a paywall/upsell card explaining the feature and
     directing to upgrade (there's no checkout flow yet — a simple message
     plus a link to the pricing section on the landing page, if one exists,
     is enough for now).
   - **Paid, no active key:** key setup UI — choose a provider, paste a key,
     optional label, save (this hits `POST /api/ai-keys`, which validates
     before persisting).
   - **Paid, key configured:** the chat UI — free-text question box, submit,
     shows the returned answer. Support a provider/key picker if more than
     one key is saved. Single-turn Q&A is enough for v1 (see Non-goals).
   - Before a user's **first** AI question, show a one-time disclosure that
     their trade data will be sent to the third-party provider they
     configured, using their own key.
   - Update the on-page copy — the current "no AI, no API key, just math"
     tagline is no longer true and needs to go.

7. **Cleanup.** Grep for other importers of `src/lib/ask/queries.ts` and
   `src/app/ask/answer-card.tsx` before deleting them; if nothing else
   depends on them, remove them cleanly rather than leaving dead code.

8. **Tests.** Follow the existing colocation convention
   (`src/lib/strategies/queries.test.ts` etc.): cover the crypto round-trip
   (`encrypt(decrypt(x)) === x`), the new zod schemas, and `isPaidUser`, at
   minimum.

### Out of scope

- Any real payment/checkout/billing integration (Stripe or otherwise).
  `plan` is flipped manually (e.g. via the Supabase table editor) for now.
- Client-side-only key storage. Keys are stored server-side, encrypted.
- Streaming AI responses — return a plain JSON answer for v1.
- Multi-turn conversation memory / persisting chat history across page
  loads or sessions — each question is answered independently.
- An admin UI for managing users' plans in bulk.
- Reusing a shared/project-level AI API key for anyone — every call must use
  the requesting user's own stored key. Never add a project-wide AI key to
  this app's own environment for this feature.
- Rebuilding the old rule-based math answers anywhere else in the app —
  they're being removed, not relocated.

## Requirements / Acceptance criteria

1. `supabase/migrations/0029_*.sql` adds the `plan` column on `user_settings`
   and the new `user_api_keys` table with owner-only RLS, using this
   project's existing migration conventions (manual-apply header comment,
   `set_updated_at` trigger reuse, matching policy shape).
2. `UserSettings` includes `plan`; `getUserSettings()` returns it (defaulting
   `'free'`).
3. `isPaidUser()` exists and gates every new route and every paid-only UI
   state below.
4. `src/lib/ai-keys/crypto.ts` encrypts/decrypts with a server-only secret
   that is documented in `.env.local.example`.
5. `GET`/`POST /api/ai-keys` and `DELETE /api/ai-keys/[id]` all return `401`
   unauthenticated and `403` for a free-plan user; `POST` validates input
   with zod and test-validates the key against the real provider before
   saving, rejecting with a clear message on failure.
6. Stored keys are encrypted at rest; no endpoint ever returns a decrypted
   key back to the client — only masked metadata.
7. `openai.ts`, `anthropic.ts`, `google.ts` all implement the same
   `AIProvider` interface from a shared `types.ts`.
8. `POST /api/ask-ai` enforces auth, paid plan, rate limiting, and per-user
   data scoping (no cross-user trade data ever enters the prompt); returns a
   clear, distinct error for "bad key" vs. "provider unavailable" vs.
   generic failure.
9. `src/app/ask/page.tsx` no longer renders the old deterministic
   category/answer cards; it renders the paywall, key-setup, or chat state
   described above depending on plan and key status. The old `"no AI, no API
   key, just math"` copy is gone.
10. The old rule-based implementation (`src/lib/ask/queries.ts`, the answer-
    card usage tied to it) is removed once confirmed unused elsewhere — not
    left dead in the tree.
11. A one-time data-sharing disclosure appears before a user's first AI
    question.
12. `npm run test` and `npm run lint` both pass. New pure logic (crypto
    round-trip, schemas, `isPaidUser`) has vitest coverage.

## Technical approach

Covered inline in Scope above — follow this repo's existing patterns for
auth, validation, migrations, rate limiting, and comment style rather than
introducing new ones. The two things intentionally left to your judgment:

- **Context retrieval for the AI prompt** (Scope item 5): pick whatever
  approach produces accurate, relevant answers within a reasonable token
  budget. You may find it useful to look at what `src/lib/analytics/queries.ts`
  already computes as a starting point, but you're not required to reuse it.
- **Exact page/component layout** for the key-setup and chat UI (Scope item
  6): follow this repo's page.tsx-composes-client-component shape, but the
  specific breakdown into files/components is your call.

## Non-goals / constraints

- Never let this feature call an AI provider using anything other than the
  requesting user's own key — no project-level fallback key, ever.
- Don't change the `/ask` route path or remove its nav entry — same URL,
  new content.
- Don't leave `src/lib/ask/queries.ts` or its old consumers half-removed;
  grep for other importers before deleting.
- Don't skip the "test the key before saving it" step — a silently-saved bad
  key produces a confusing failure the first time the user asks a question
  instead of an immediate, actionable one at setup time.

## Open questions

- Whether a lightweight internal/admin way to flip a test user's `plan` to
  `'paid'` is wanted beyond editing the row directly in Supabase — assume
  the direct DB edit is sufficient unless told otherwise.
- Which specific model to default to per provider (e.g. cost/speed tier) is
  not specified here — pick a sensible default per provider and call it out
  rather than silently choosing, since it affects both answer quality and
  the user's own API cost.
