import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

/**
 * Throwaway users for the E2E suite, created and destroyed through the admin
 * API rather than through the sign-up form.
 *
 * **Why not just use the demo account.** These tests create trades, edit them
 * and delete them. Pointed at demo@tradinglens.app they would corrupt the
 * account that exists to show the app off, and every run would leave residue.
 * A user per run that is deleted afterwards keeps the suite repeatable and
 * leaves the project as it found it.
 *
 * **Why the admin API and not the UI.** Two reasons, and the second is the one
 * that matters later:
 *  1. Signing up through the form is slow and is itself under test in
 *     auth.spec.ts -- every other spec depending on it would mean one broken
 *     form fails all three.
 *  2. **Service-role calls bypass CAPTCHA.** Once Turnstile is switched on in
 *     the Supabase dashboard, browser-driven sign-in needs a valid token, and
 *     Cloudflare's dummy sitekey only validates against the dummy secret --
 *     which this project cannot use, since it has one Supabase project and one
 *     secret shared with production. Establishing sessions this way keeps the
 *     autosave and OCR specs working regardless. See README.md.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "E2E needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
      "They are read from .env.local by playwright.config.ts -- see e2e/README.md.",
  );
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Whether Supabase is currently rejecting auth calls that carry no CAPTCHA
 * token, determined by asking it rather than by a hand-maintained flag.
 *
 * **Why this is detected and not configured.** auth.spec.ts drives the real
 * sign-in form, and once CAPTCHA is enforced that form needs a token no
 * automated browser can mint -- Cloudflare's dummy sitekey only validates
 * against the dummy secret, and this project has one Supabase project sharing
 * one secret with production. So those tests genuinely cannot pass, and a
 * suite that is permanently three-red is a suite people stop reading.
 *
 * Skipping on a detected condition rather than a checked-in constant means
 * the tests come BACK automatically if CAPTCHA is ever turned off, instead of
 * staying silently disabled because nobody remembered to flip a flag.
 *
 * Deliberately bogus credentials: a wrong password answers
 * `invalid_credentials`, which proves the request got past the CAPTCHA gate.
 * `captcha_failed` proves it did not.
 */
let captchaProbe: Promise<boolean> | null = null;

export function captchaEnforced(): Promise<boolean> {
  captchaProbe ??= (async () => {
    try {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "captcha-probe@tradinglens-e2e.invalid",
          password: "not-a-real-password",
        }),
      });
      const body: unknown = await res.json().catch(() => ({}));
      const code = (body as { error_code?: string }).error_code ?? "";
      const msg = (body as { msg?: string }).msg ?? "";
      return code === "captcha_failed" || /captcha/i.test(msg);
    } catch {
      // Unreachable Supabase is a different failure, and one the tests should
      // report rather than skip over.
      return false;
    }
  })();
  return captchaProbe;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/**
 * `.invalid` is reserved by RFC 2606 and can never resolve, so a stray
 * confirmation or reset email has nowhere to go even if one were sent.
 */
function throwawayEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@tradinglens-e2e.invalid`;
}

export async function createTestUser(): Promise<TestUser> {
  const email = throwawayEmail();
  const password = `E2e!${Math.random().toString(36).slice(2)}Aa1`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    // Independent of whether the project requires confirmation, so the suite
    // does not silently start failing if that dashboard setting is changed.
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test user: ${error?.message}`);

  return { id: data.user.id, email, password };
}

export async function deleteTestUser(userId: string): Promise<void> {
  // Every user-data table cascades from auth.users (on delete cascade), so
  // deleting the user removes the trades, folders and strategies a test made
  // without this needing to know what those tables are.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`could not delete test user ${userId}: ${error.message}`);
}

/** Deletes a user found by email. Used to clean up an account that the
 *  sign-up FORM created, whose id the test never saw. */
export async function deleteUserByEmail(email: string): Promise<void> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = data?.users.find((user) => user.email === email);
  if (found) await deleteTestUser(found.id);
}

/**
 * Signs a browser context in without touching the sign-in form.
 *
 * Uses a service-role magic link fed through the app's own
 * /auth/confirm route, which calls verifyOtp and writes the cookie session
 * server-side -- the same code path a real emailed link takes. That avoids
 * hand-crafting @supabase/ssr's cookie format (which is chunked and would
 * break the moment that library changed) and avoids the password grant, which
 * is the endpoint CAPTCHA will guard.
 */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (error || !data.properties) throw new Error(`could not mint link: ${error?.message}`);

  const tokenHash = data.properties.hashed_token;
  await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard`);
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}
