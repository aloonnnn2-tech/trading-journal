import { authClient, clearSessionCookies } from "@/lib/auth/server-auth";

// Sign-out, on the server (security gaps pass, Phase 1b): the browser can't
// clear an HttpOnly cookie itself. Ends the session at Supabase, then clears
// the cookies regardless -- a session that is already gone (an expired one,
// or an account just deleted) must still leave the browser signed out.

export async function POST(request: Request) {
  try {
    const supabase = await authClient(request);
    await supabase.auth.signOut();
  } catch {
    // Signed out locally below either way.
  }
  await clearSessionCookies();
  return Response.json({ ok: true });
}
