import { z } from "zod";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { authClient, authFailure, badRequest, passwordField, readJson } from "@/lib/auth/server-auth";

// Setting a new password, on the server (security gaps pass, Phase 1b). The
// reset link (/auth/confirm) signs the person in first; this changes the
// password of whoever is signed in, and no one else.

const body = z.object({ password: passwordField });

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return Response.json({ error: { code: "session_not_found", status: 401 } }, { status: 401 });
  }
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return badRequest();

  const limited = await enforceRateLimit(`auth:update-password:${userId}`, 10, 60 * 60_000);
  if (limited) {
    return Response.json({ error: { code: "over_request_rate_limit", status: 429 } }, { status: 429 });
  }

  const supabase = await authClient(request);
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return authFailure(error);
  return Response.json({ ok: true });
}
