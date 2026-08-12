import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles links from Supabase auth emails that verify an OTP (currently
// just password recovery -- signup no longer requires email confirmation).
// The email template must point here with token_hash + type rather than
// using Supabase's default hosted verify link -- this app uses
// cookie-based SSR sessions, so the session needs to be established
// server-side, in this route, not via a URL fragment the client-side JS
// would otherwise need to auto-detect.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Only ever a path on this site. `next` arrives from the query string and
  // is fed to `new URL(next, request.url)`, which happily accepts an absolute
  // URL and returns it as-is -- so a link like
  // /auth/confirm?...&next=https://example.com would redirect a
  // freshly-authenticated user straight off the site.
  //
  // Resolve first, then compare origins. Prefix-checking the raw string for
  // "/" and not "//" looks equivalent and isn't: URL treats a backslash as a
  // slash under a special scheme, so `next=/\evil.com` passes that check and
  // still resolves to http://evil.com/. Only the resolved origin is
  // trustworthy, and the redirect reuses that resolved URL so nothing can
  // differ between what was checked and what is sent.
  const requestedNext = searchParams.get("next");
  const origin = new URL(request.url).origin;
  let destination = new URL("/dashboard", origin);
  if (requestedNext) {
    try {
      const resolved = new URL(requestedNext, origin);
      if (resolved.origin === origin) destination = resolved;
    } catch {
      // Unparseable -- keep the dashboard default.
    }
  }

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(destination);
    }
  }

  return NextResponse.redirect(new URL("/sign-in?error=confirmation_failed", request.url));
}
