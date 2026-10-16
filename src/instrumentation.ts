import * as Sentry from "@sentry/nextjs";
import { SENTRY_PRIVACY, SENTRY_SERVER_PRIVACY } from "@/lib/observability/sentry-options";
import { RUNTIME_REQUIRED, missingEnv, missingEnvMessage } from "@/lib/env/required";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Named at startup, in the function log, rather than discovered by the
    // first request that needs one (src/lib/env/required.ts).
    const missing = missingEnv(RUNTIME_REQUIRED, process.env);
    if (missing.length > 0) console.error(missingEnvMessage(missing, "server start"));

    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      // This runtime is the only place a decrypted provider key ever exists.
      // Everything leaving for Sentry is scrubbed first, and bodies, cookies
      // and local variables are never captured -- see sentry-options.ts.
      ...SENTRY_SERVER_PRIVACY,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      ...SENTRY_PRIVACY,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
