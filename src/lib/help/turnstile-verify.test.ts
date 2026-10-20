import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captchaSecret, verifyCaptcha } from "./turnstile-verify";
import { TURNSTILE_TEST_SECRET } from "@/lib/env/turnstile-test-keys";

const fetchMock = vi.fn();
const opts = { ip: "203.0.113.7", action: "help", hostname: "tradinglenz.netlify.app" };
const answer = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });
const fresh = () => new Date().toISOString();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAA-real-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("verifyCaptcha", () => {
  it("passes a fresh token for this site and this form", async () => {
    answer({ success: true, hostname: opts.hostname, action: "help", challenge_ts: fresh() });
    expect(await verifyCaptcha("tok", opts)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const sent = init.body as URLSearchParams;
    expect(sent.get("secret")).toBe("0x4AAAAAAA-real-secret");
    expect(sent.get("response")).toBe("tok");
    expect(sent.get("remoteip")).toBe(opts.ip);
    expect(init.redirect).toBe("error");
  });

  it("refuses: no token, a failed check, another site, another form, an old token", async () => {
    expect(await verifyCaptcha(undefined, opts)).toEqual({ ok: false, reason: "missing" });
    answer({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyCaptcha("tok", opts)).toEqual({ ok: false, reason: "failed" });
    answer({ success: true, hostname: "evil.example", action: "help", challenge_ts: fresh() });
    expect(await verifyCaptcha("tok", opts)).toEqual({ ok: false, reason: "wrong_site" });
    answer({ success: true, hostname: opts.hostname, action: "sign-in", challenge_ts: fresh() });
    expect(await verifyCaptcha("tok", opts)).toEqual({ ok: false, reason: "wrong_action" });
    answer({ success: true, hostname: opts.hostname, action: "help", challenge_ts: new Date(Date.now() - 400_000).toISOString() });
    expect(await verifyCaptcha("tok", opts)).toEqual({ ok: false, reason: "stale" });
  });

  it("says 'unavailable' when Cloudflare can't be reached, never 'passed'", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect(await verifyCaptcha("tok", opts)).toEqual({ ok: false, reason: "unavailable" });
    answer({}, false);
    expect(await verifyCaptcha("tok", opts)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("fails closed in production without a secret, or with Cloudflare's always-pass test secret", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(await verifyCaptcha("tok", opts)).toEqual({ ok: false, reason: "not_configured" });
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_TEST_SECRET);
    expect(await verifyCaptcha("tok", opts)).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("in development, skips the check without a secret and accepts the test secret's pass", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(captchaSecret()).toBeNull();
    expect(await verifyCaptcha(undefined, opts)).toEqual({ ok: true });
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_TEST_SECRET);
    answer({ success: true, hostname: "example.com" });
    expect(await verifyCaptcha("XXXX.DUMMY.TOKEN.XXXX", opts)).toEqual({ ok: true });
  });
});
