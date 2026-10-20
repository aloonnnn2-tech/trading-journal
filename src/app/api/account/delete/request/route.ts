import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { authClient, authFailure, captchaField, readJson, siteOrigin } from "@/lib/auth/server-auth";
import { DELETION_WINDOW_MS, newDeletionToken } from "@/lib/account/deletion-proof";
import { isMissingTableError } from "@/lib/supabase/errors";
import { log } from "@/lib/observability/log";

// Step 1 of deleting an account (2026-10-20): record the request and email
// a confirmation link to the account's own address. Nothing is deleted here.
// The link carries a one-time code; /account/delete/confirm/<code> deletes,
// and only for that code (src/lib/account/deletion-proof.ts).
//
// The address is the verified account's, never one from the request, so this
// can only ever email the account's owner. The email itself is Supabase's
// "Magic link" one -- its default ("Your sign-in link") unless a custom email
// service lets the template be edited (docs/security/delete-account-email.md).
// Supabase checks the CAPTCHA token on that call, as on sign-in.

const body = z.object({ captchaToken: captchaField });

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const limited = await enforceRateLimit(
    `account-delete-request:${userId}`,
    3,
    60 * 60_000,
    "You've asked for a few deletion links already. Use the newest email, or try again in an hour.",
  );
  if (limited) return limited;

  const { data } = await (await createClient()).auth.getUser();
  const email = data.user?.id === userId ? data.user.email : null;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Account deletion isn't configured yet. Contact support." }, { status: 501 });
  }

  // A fresh code each time: asking again makes every earlier email's link
  // stop working. Only its hash is stored; the code itself goes into the
  // email and nowhere else -- not into this response.
  const { token, hash } = newDeletionToken();
  const now = Date.now();
  const { error: saveError } = await admin.from("account_deletion_requests").upsert({
    user_id: userId,
    requested_at: new Date(now).toISOString(),
    expires_at: new Date(now + DELETION_WINDOW_MS).toISOString(),
    token_hash: hash,
  });
  if (saveError) {
    log.error("account.delete_request_save_failed", { error: saveError });
    return NextResponse.json(
      {
        error: isMissingTableError(saveError)
          ? "Account deletion needs a database update that hasn't been applied yet. Contact support."
          : "Couldn't start the deletion. Try again in a minute.",
      },
      { status: 503 },
    );
  }

  // Supabase's email link ends at emailRedirectTo, which carries our code.
  // Supabase sends people there even when its own part of the link failed
  // (used, expired, opened by a mail scanner first), so the code always
  // arrives. The address must match the Redirect URLs list in Supabase:
  // ".../account/delete/confirm/*" (docs/security/delete-account-email.md).
  // The cookie-bound client keeps Supabase's flow PKCE, so the ?code= it
  // adds is useless anywhere but this browser -- the page ignores it.
  const supabase = await authClient(request);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      captchaToken: parsed.data.captchaToken,
      emailRedirectTo: `${siteOrigin(request)}/account/delete/confirm/${token}`,
    },
  });
  if (error) {
    log.warn("account.delete_request_email_failed", { code: error.code ?? null, status: error.status ?? null });
    return authFailure(error);
  }
  return NextResponse.json({ ok: true, email });
}
