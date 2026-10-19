import { z } from "zod";
import {
  authClient,
  authFailure,
  badRequest,
  captchaField,
  emailField,
  enforceAuthLimits,
  readJson,
  siteOrigin,
} from "@/lib/auth/server-auth";

// "Send the confirmation email again", on the server (security gaps pass,
// Phase 1b). Supabase sends nothing to an address that is already confirmed
// or has no account, and still answers OK, so this reveals neither.

const body = z.object({ email: emailField, captchaToken: captchaField });

export async function POST(request: Request) {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return badRequest();
  const { email, captchaToken } = parsed.data;

  const limited = await enforceAuthLimits("resend", request, email);
  if (limited) return limited;

  const supabase = await authClient(request);
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${siteOrigin(request)}/auth/confirm?next=/dashboard`, captchaToken },
  });
  if (error) return authFailure(error);
  return Response.json({ ok: true });
}
