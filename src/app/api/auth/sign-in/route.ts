import { z } from "zod";
import {
  authClient,
  authFailure,
  badRequest,
  captchaField,
  emailField,
  enforceAuthLimits,
  passwordField,
  readJson,
} from "@/lib/auth/server-auth";

// Email + password sign-in, on the server so the session cookie it sets can
// be HttpOnly (security gaps pass, Phase 1b). Same Supabase call the sign-in
// page made, same CAPTCHA token, same error codes back.

const body = z.object({ email: emailField, password: passwordField, captchaToken: captchaField });

export async function POST(request: Request) {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return badRequest();
  const { email, password, captchaToken } = parsed.data;

  const limited = await enforceAuthLimits("sign-in", request, email);
  if (limited) return limited;

  const supabase = await authClient(request);
  const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (error) return authFailure(error);
  return Response.json({ ok: true });
}
