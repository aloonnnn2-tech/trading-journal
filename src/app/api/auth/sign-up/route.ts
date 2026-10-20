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
  siteOrigin,
} from "@/lib/auth/server-auth";
import { TERMS_VERSION } from "@/lib/legal/terms";

// Sign-up, on the server (security gaps pass, Phase 1b). With email
// confirmation on (production), Supabase answers with no session and the
// page says "check your inbox"; it answers the same way for an address that
// already has an account, so the reply never reveals one exists.

const body = z.object({
  email: emailField,
  password: passwordField,
  captchaToken: captchaField,
  // The age and terms checkbox. Required here too, not only in the form.
  agreed: z.literal(true),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return badRequest();
  const { email, password, captchaToken } = parsed.data;

  const limited = await enforceAuthLimits("sign-up", request, email);
  if (limited) return limited;

  const supabase = await authClient(request);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // The email template sends the user through /auth/confirm, which
      // exchanges the token for a cookie session before forwarding them on.
      emailRedirectTo: `${siteOrigin(request)}/auth/confirm?next=/dashboard`,
      captchaToken,
      // Read by the database at account creation (migration 0061), which
      // records WHEN with its own clock. The terms version is ours, not the
      // browser's.
      data: { age_confirmed: true, accepted_terms_version: TERMS_VERSION },
    },
  });
  if (error) return authFailure(error);
  return Response.json({ ok: true, session: Boolean(data.session) });
}
