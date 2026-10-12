import * as Sentry from "@sentry/nextjs";
import { SENTRY_PRIVACY } from "@/lib/observability/sentry-options";
import { setZodJitless } from "@/lib/observability/zod-jitless";

// Before any app code in the browser: zod must never probe for eval under
// the enforcing CSP. Done without importing zod -- see zod-jitless.ts.
setZodJitless();

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // A plaintext provider key is never supposed to reach the browser at all --
  // the whole point of proxying providers server-side. Scrubbed here anyway,
  // because "never supposed to" is an assertion about current code and this
  // costs nothing to hold true regardless.
  ...SENTRY_PRIVACY,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
