import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/observability/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // A plaintext provider key is never supposed to reach the browser at all --
  // the whole point of proxying providers server-side. Scrubbed here anyway,
  // because "never supposed to" is an assertion about current code and this
  // costs nothing to hold true regardless.
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
