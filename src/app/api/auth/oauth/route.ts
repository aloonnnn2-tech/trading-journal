import { z } from "zod";
import { OAUTH_PROVIDERS } from "@/lib/auth/oauth-providers";
import { authClient, authFailure, badRequest, enforceAuthLimits, readJson, siteOrigin } from "@/lib/auth/server-auth";

// Starts "Continue with Google", on the server (security gaps pass, Phase
// 1b). Supabase's PKCE code verifier is written as a cookie here, HttpOnly
// like the session, and read back by /auth/callback when Google returns. The
// page gets the provider's URL and navigates to it.

const body = z.object({
  provider: z.enum(OAUTH_PROVIDERS.map((p) => p.id) as [string, ...string[]]),
  // Where to land after sign-in. /auth/callback runs it through afterSignIn,
  // which only ever allows a path on this site.
  next: z.string().max(512).nullish(),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return badRequest();

  const limited = await enforceAuthLimits("oauth", request);
  if (limited) return limited;

  const callback = new URL("/auth/callback", siteOrigin(request));
  if (parsed.data.next) callback.searchParams.set("next", parsed.data.next);

  const supabase = await authClient(request);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: parsed.data.provider as (typeof OAUTH_PROVIDERS)[number]["id"],
    options: { redirectTo: callback.href, skipBrowserRedirect: true },
  });
  if (error || !data.url) return authFailure(error);
  return Response.json({ url: data.url });
}
