// Cloudflare Turnstile's published always-pass TEST keys
// (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
// No imports, so both the app (src/lib/help/turnstile-verify.ts) and the
// dev/e2e tooling (src/lib/env/dev-project.ts) can share them.

/** Always-pass site key: the widget renders and hands over a dummy token. */
export const TURNSTILE_TEST_SITEKEY = "1x00000000000000000000AA";

/** Always-pass secret: our own server check accepts that dummy token. */
export const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
