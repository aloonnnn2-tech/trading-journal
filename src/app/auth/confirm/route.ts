import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";

// Handles the link from Supabase's "Confirm signup" email. The email
// template must point here with token_hash + type (see the migration
// guide) rather than using Supabase's default hosted verify link -- this
// app uses cookie-based SSR sessions, so the session needs to be
// established server-side, in this route, not via a URL fragment the
// client-side JS would otherwise need to auto-detect.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  if (token_hash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // Only a real new-account confirmation counts as signup_completed --
      // this route also handles recovery/invite/magic-link verification,
      // which aren't signups.
      if (type === "signup" && data.user) {
        void logEvent(supabase, data.user.id, SERVER_SESSION_ID, "signup_completed");
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/sign-in?error=confirmation_failed", request.url));
}
