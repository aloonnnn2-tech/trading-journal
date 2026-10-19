import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { otpType, safeDestination } from "@/lib/auth/confirm-link";

// Uses an emailed auth link's one-time token (sign-up confirmation, password
// recovery, magic link): verifies it and sets the cookie session server-side.
//
// **POST only, from the button on /auth/confirm.** It used to run on the GET
// of the emailed link itself, and a one-time token used on GET is spent by
// whatever opens the link first. Mail providers' link scanners (Outlook Safe
// Links, Gmail, corporate filters) open every link in an email before the
// person does: the scanner confirmed the account, and the person's own click
// then failed with otp_expired -- "That confirmation link is invalid or has
// expired" -- for an account that was in fact confirmed. Resending did
// nothing either, since Supabase sends no confirmation to a confirmed account
// (and still answers "sent"). Scanners fetch links; they don't press buttons.
// Reproduced 2026-10-15 on the dev project: the second verify of a token
// answers otp_expired (403).
export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin;

  // Only our own confirm page posts here. A form on another site could
  // otherwise sign a visitor into an account of the attacker's choosing.
  const from = request.headers.get("origin");
  if (from && from !== origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const form = await request.formData();
  const token_hash = form.get("token_hash");
  const type = otpType(typeof form.get("type") === "string" ? (form.get("type") as string) : null);
  const next = form.get("next");
  const destination = safeDestination(typeof next === "string" ? next : null, origin);

  if (typeof token_hash === "string" && token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    // 303: the browser follows a POST's redirect with a GET.
    if (!error) return NextResponse.redirect(destination, 303);
  }

  // Already used or expired. Sign-in says what that means for this kind of
  // link -- for a sign-up link, usually "you're confirmed, just sign in".
  const failed = new URL("/sign-in", origin);
  failed.searchParams.set("error", "confirmation_failed");
  if (type === "recovery") failed.searchParams.set("kind", "recovery");
  return NextResponse.redirect(failed, 303);
}
