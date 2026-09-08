import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/observability/scrub";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      // This runtime is the only place a decrypted provider key ever exists.
      // Everything leaving for Sentry is scrubbed first -- see scrub.ts.
      beforeSend: scrubEvent,
      beforeSendTransaction: scrubEvent,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      beforeSend: scrubEvent,
      beforeSendTransaction: scrubEvent,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
