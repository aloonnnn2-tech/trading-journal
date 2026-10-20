import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";

// Who is signed in, for the two places the browser used to read the session
// itself (security gaps pass, Phase 1b): the reset-password page (is the
// recovery link's session there?) and the paid-plan dialog (prefill the
// waitlist email). The browser can't read the HttpOnly cookie, so it asks.
// Only the caller's own email, and only when signed in.

export async function GET() {
  const userId = await getUserIdFromHeader();
  if (!userId) return Response.json({ signedIn: false, email: null });
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return Response.json(
    { signedIn: Boolean(data.user), email: data.user?.email ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
