// The browser half of the /api/auth/* routes (security gaps pass, Phase 1b).
// Each call answers `{ error }` in the shape the Supabase SDK used to --
// `{ code, status }` -- so the pages keep passing it to authErrorMessage and
// isEmailNotConfirmed unchanged. A network failure comes back as the
// TypeError fetch throws, which authErrorMessage already reads as "offline".

export interface AuthCallError {
  code: string | null;
  status: number | null;
}

export type AuthResult<T = Record<string, never>> =
  | ({ error: null } & T)
  | { error: AuthCallError | TypeError | Error };

async function call<T>(path: string, body?: unknown): Promise<AuthResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    return { error: err instanceof Error ? err : new TypeError("Network request failed") };
  }
  const json = (await res.json().catch(() => null)) as ({ error?: AuthCallError } & T) | null;
  if (!res.ok || json?.error) {
    return { error: json?.error ?? { code: null, status: res.status } };
  }
  return { ...(json as T), error: null };
}

export const authApi = {
  signIn: (email: string, password: string, captchaToken?: string) =>
    call("sign-in", { email, password, captchaToken }),
  signUp: (email: string, password: string, captchaToken?: string) =>
    call<{ session: boolean }>("sign-up", { email, password, captchaToken, agreed: true }),
  signOut: () => call("sign-out"),
  forgotPassword: (email: string, captchaToken?: string) => call("forgot-password", { email, captchaToken }),
  resendConfirmation: (email: string, captchaToken?: string) => call("resend", { email, captchaToken }),
  updatePassword: (password: string) => call("update-password", { password }),
  oauth: (provider: string, next?: string | null) => call<{ url: string }>("oauth", { provider, next }),
  /** Who is signed in. Never throws: an error reads as signed out. */
  async session(): Promise<{ signedIn: boolean; email: string | null }> {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) return { signedIn: false, email: null };
      return (await res.json()) as { signedIn: boolean; email: string | null };
    } catch {
      return { signedIn: false, email: null };
    }
  },
};
