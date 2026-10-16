import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { afterSignIn } from "@/lib/auth/next-path";
import { SERVER_SESSION_ID, logEvent } from "@/lib/tracking/log";

// An account this young was made by this very sign-in: Google sign-up and
// sign-in are the same click, so the account's age is the only tell.
const NEW_ACCOUNT_MS = 2 * 60 * 1000;

// Where Google (and any later sign-in provider) sends people back. Supabase
// appends a one-time `code`; exchanging it here sets the cookie session
// server-side, as /auth/confirm/verify does for emailed links.
//
// The exchange needs the PKCE verifier that signInWithOAuth left in THIS
// browser's cookies, so a code opened anywhere else -- another browser, a
// link scanner -- is useless; GET is safe here in a way it wasn't for the
// emailed links.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // The same short allow-list as password sign-in (src/lib/auth/next-path.ts).
  const destination = new URL(afterSignIn(url.searchParams.get("next")), url.origin);

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Password sign-in and sign-up record these from the browser; this
      // path never runs that code, so record them here or Google users
      // vanish from the admin counts. The user id comes from the session
      // just made, not from anything the request said. Awaited: on a
      // serverless host, work left running after the response can be cut.
      const user = data.user;
      if (user) {
        const isNew = Date.now() - new Date(user.created_at).getTime() < NEW_ACCOUNT_MS;
        await logEvent(user.id, SERVER_SESSION_ID, isNew ? "signup_completed" : "login");
      }
      return NextResponse.redirect(destination);
    }
  }

  // Cancelled at Google's screen (?error=access_denied), or a code that
  // didn't exchange. Sign-in says so and the other ways in stay open.
  const failed = new URL("/sign-in", url.origin);
  failed.searchParams.set("error", url.searchParams.get("error") === "access_denied" ? "oauth_cancelled" : "oauth_failed");
  return NextResponse.redirect(failed);
}
