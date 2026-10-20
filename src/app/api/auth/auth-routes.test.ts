import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Security gaps pass, Phase 1b: the server-side auth routes. Supabase is
// faked at createServerClient, so these check what each route sends, what
// it answers, and that limits and cookies behave -- the real flows run in
// e2e/auth-httponly.spec.ts against the dev project.

const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  resend: vi.fn(),
  updateUser: vi.fn(),
  signInWithOAuth: vi.fn(),
  getUser: vi.fn(),
};
const createServerClient = vi.fn((..._args: unknown[]) => ({ auth }));
const jar = new Map<string, string>();
const cookieSets: { name: string; value: string; options: Record<string, unknown> }[] = [];
const rateLimit = vi.fn();
const enforceRateLimit = vi.fn();
const getUserIdFromHeader = vi.fn();

vi.mock("@supabase/ssr", () => ({ createServerClient: (...a: unknown[]) => createServerClient(...a) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieSets.push({ name, value, options });
      jar.set(name, value);
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...a: unknown[]) => rateLimit(...a),
  enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
  clientIpKey: (h: Headers) => h.get("x-nf-client-connection-ip") ?? "unknown",
}));
vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));

const signIn = await import("./sign-in/route");
const signUp = await import("./sign-up/route");
const signOut = await import("./sign-out/route");
const forgot = await import("./forgot-password/route");
const resend = await import("./resend/route");
const updatePassword = await import("./update-password/route");
const oauth = await import("./oauth/route");
const session = await import("./session/route");
const { TERMS_VERSION } = await import("@/lib/legal/terms");

const IP = "203.0.113.7";
const post = (body: unknown) =>
  new Request("https://tradinglenz.netlify.app/api/auth/x", {
    method: "POST",
    headers: { "content-type": "application/json", "x-nf-client-connection-ip": IP },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  jar.clear();
  cookieSets.length = 0;
  rateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
  enforceRateLimit.mockResolvedValue(null);
  for (const fn of Object.values(auth)) fn.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/auth/sign-in", () => {
  it("signs in with the CAPTCHA token and answers ok", async () => {
    const res = await signIn.POST(post({ email: "A@Example.com", password: "pw-123456", captchaToken: "tok" }));
    expect(res.status).toBe(200);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "A@Example.com",
      password: "pw-123456",
      options: { captchaToken: "tok" },
    });
  });

  it("passes on Supabase's code and status, never its message", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials (internal detail)" },
    });
    const res = await signIn.POST(post({ email: "a@example.com", password: "x" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "invalid_credentials", status: 400 } });
    expect(JSON.stringify(body)).not.toMatch(/internal detail/);
  });

  it("answers a bad body with validation_failed and never calls Supabase", async () => {
    for (const bad of ["not json", { email: "nope", password: "x" }, { email: "a@example.com" }]) {
      const res = await signIn.POST(post(bad));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("validation_failed");
    }
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("limits per IP and per address, keyed by a hash so no address is stored", async () => {
    await signIn.POST(post({ email: "Someone@Example.com", password: "x" }));
    const keys = rateLimit.mock.calls.map((c) => c[0] as string);
    expect(keys[0]).toBe(`auth:sign-in:ip:${IP}`);
    expect(keys[1]).toMatch(/^auth:sign-in:email:[0-9a-f]{32}$/);
    expect(keys.join()).not.toMatch(/someone|example/i);
  });

  it("refuses with Supabase's own rate-limit code when a limit is hit", async () => {
    rateLimit.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 120 });
    const res = await signIn.POST(post({ email: "a@example.com", password: "x" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect((await res.json()).error).toEqual({ code: "over_request_rate_limit", status: 429 });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("turns a Supabase server error into a 502 with no detail", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: "unexpected_failure", status: 500, message: "db" } });
    const res = await signIn.POST(post({ email: "a@example.com", password: "x" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toEqual({ code: "unexpected_failure", status: 500 });
  });
});

describe("the session cookie", () => {
  it("is written HttpOnly, SameSite=Lax, through the route's cookie store", async () => {
    await signIn.POST(post({ email: "a@example.com", password: "x" }));
    const options = createServerClient.mock.calls[0][2] as { cookieOptions: Record<string, unknown> };
    expect(options.cookieOptions).toMatchObject({ httpOnly: true, sameSite: "lax" });
  });

  it("uses the anon key and forwards no IP unless an sb_secret key is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    await signIn.POST(post({ email: "a@example.com", password: "x" }));
    const [, key, options] = createServerClient.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(key).toBe("anon-key");
    expect(options.global).toBeUndefined();
  });

  it("forwards the user's IP to Supabase (Sb-Forwarded-For) once a secret key is set", async () => {
    vi.stubEnv("SUPABASE_AUTH_SECRET_KEY", "sb_secret_test_value");
    await signIn.POST(post({ email: "a@example.com", password: "x" }));
    const [, key, options] = createServerClient.mock.calls[0] as [string, string, { global?: { headers: Record<string, string> } }];
    expect(key).toBe("sb_secret_test_value");
    expect(options.global?.headers["sb-forwarded-for"]).toBe(IP);
  });

  it("ignores a key that isn't a new-style secret key", async () => {
    vi.stubEnv("SUPABASE_AUTH_SECRET_KEY", "eyJ-legacy-jwt");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    await signIn.POST(post({ email: "a@example.com", password: "x" }));
    expect(createServerClient.mock.calls[0][1]).toBe("anon-key");
  });
});

describe("POST /api/auth/sign-up", () => {
  it("requires the age and terms agreement", async () => {
    const res = await signUp.POST(post({ email: "a@example.com", password: "pw-123456" }));
    expect(res.status).toBe(400);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("sends our terms version and a confirmation link on this site", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const res = await signUp.POST(post({ email: "a@example.com", password: "pw-123456", agreed: true, captchaToken: "t" }));
    expect(await res.json()).toEqual({ ok: true, session: false });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "pw-123456",
      options: {
        emailRedirectTo: "https://tradinglenz.netlify.app/auth/confirm?next=/dashboard",
        captchaToken: "t",
        data: { age_confirmed: true, accepted_terms_version: TERMS_VERSION },
      },
    });
  });

  it("says when a session came back (a project without confirmation)", async () => {
    auth.signUp.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
    const res = await signUp.POST(post({ email: "a@example.com", password: "pw-123456", agreed: true }));
    expect(await res.json()).toEqual({ ok: true, session: true });
  });
});

describe("POST /api/auth/forgot-password and /resend", () => {
  it("sends the reset link to /reset-password on this site", async () => {
    await forgot.POST(post({ email: "a@example.com", captchaToken: "t" }));
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@example.com", {
      redirectTo: "https://tradinglenz.netlify.app/auth/confirm?next=/reset-password",
      captchaToken: "t",
    });
  });

  it("resends the sign-up confirmation", async () => {
    await resend.POST(post({ email: "a@example.com" }));
    expect(auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "a@example.com",
      options: { emailRedirectTo: "https://tradinglenz.netlify.app/auth/confirm?next=/dashboard", captchaToken: undefined },
    });
  });
});

describe("POST /api/auth/sign-out", () => {
  it("clears every session cookie, even when Supabase's sign-out fails", async () => {
    jar.set("sb-abc-auth-token.0", "a");
    jar.set("sb-abc-auth-token.1", "b");
    jar.set("theme", "dark");
    auth.signOut.mockRejectedValue(new Error("session gone"));
    const res = await signOut.POST(post({}));
    expect(res.status).toBe(200);
    const cleared = cookieSets.filter((c) => c.value === "" && c.options.maxAge === 0).map((c) => c.name).sort();
    expect(cleared).toEqual(["sb-abc-auth-token.0", "sb-abc-auth-token.1"]);
  });
});

describe("POST /api/auth/update-password", () => {
  it("needs a signed-in user", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    const res = await updatePassword.POST(post({ password: "new-pass-123" }));
    expect(res.status).toBe(401);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("changes the signed-in user's password, rate-limited per user", async () => {
    getUserIdFromHeader.mockResolvedValue("user-1");
    const res = await updatePassword.POST(post({ password: "new-pass-123" }));
    expect(res.status).toBe(200);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-pass-123" });
    expect(enforceRateLimit.mock.calls[0][0]).toBe("auth:update-password:user-1");
  });
});

describe("POST /api/auth/oauth", () => {
  it("only starts a provider we offer", async () => {
    const res = await oauth.POST(post({ provider: "github" }));
    expect(res.status).toBe(400);
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("returns the provider's URL without redirecting, with the callback on this site", async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.google.com/o/oauth2/x" }, error: null });
    const res = await oauth.POST(post({ provider: "google", next: "/trades" }));
    expect(await res.json()).toEqual({ url: "https://accounts.google.com/o/oauth2/x" });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://tradinglenz.netlify.app/auth/callback?next=%2Ftrades", skipBrowserRedirect: true },
    });
  });
});

describe("GET /api/auth/session", () => {
  it("is signed out without a verified user, and never calls Supabase", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect(await (await session.GET()).json()).toEqual({ signedIn: false, email: null });
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("returns only the caller's own email, uncached", async () => {
    getUserIdFromHeader.mockResolvedValue("user-1");
    auth.getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "me@example.com" } }, error: null });
    const res = await session.GET();
    expect(await res.json()).toEqual({ signedIn: true, email: "me@example.com" });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});
