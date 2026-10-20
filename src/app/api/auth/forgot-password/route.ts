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

// "Forgot password", on the server (security gaps pass, Phase 1b). Supabase
// answers the same whether or not the address has an account, and so does
// this route, so the page's "If an account exists..." stays true.

const body = z.object({ email: emailField, captchaToken: captchaField });

export async function POST(request: Request) {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return badRequest();
  const { email, captchaToken } = parsed.data;

  const limited = await enforceAuthLimits("forgot-password", request, email);
  if (limited) return limited;

  const supabase = await authClient(request);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteOrigin(request)}/auth/confirm?next=/reset-password`,
    captchaToken,
  });
  if (error) return authFailure(error);
  return Response.json({ ok: true });
}
