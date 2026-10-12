import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { SENTRY_PRIVACY } from "@/lib/observability/sentry-options";

// zod 4 speeds up object parsing with generated code, and first probes for
// it with `Function("")`. The enforcing CSP (no 'unsafe-eval') blocks that
// probe -- harmlessly, zod falls back -- but every page then raised a CSP
// violation and sent a report (found 2026-10-11 checking the production
// build). Never try: this runs before any app code in the browser.
z.config({ jitless: true });

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
