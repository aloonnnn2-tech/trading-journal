import type { Breadcrumb } from "@sentry/nextjs";
import { scrubEvent, scrubValue } from "./scrub";

// The privacy settings every Sentry.init in this app shares (server, edge,
// browser). Pinned in code, not left to SDK defaults, so a future edit or SDK
// upgrade cannot quietly start sending request bodies, cookies or the local
// variables of the function that held a user's decrypted API key.
//
// Everything that can leave for Sentry passes a scrubbing hook: errors,
// transactions, spans and breadcrumbs (console output becomes breadcrumbs).
export const SENTRY_PRIVACY = {
  // No IPs, cookies, request bodies or user details attached automatically.
  sendDefaultPii: false,
  // Long strings are where a pasted key would hide; cap them.
  maxValueLength: 1000,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeBreadcrumb: (breadcrumb: Breadcrumb): Breadcrumb | null => scrubEvent(breadcrumb),
  // Spans can't be dropped (the SDK needs one back), so they are scrubbed.
  beforeSendSpan: <T>(span: T): T => scrubValue(span),
};

/** Server-only extra: never attach stack-frame local variables. */
export const SENTRY_SERVER_PRIVACY = {
  ...SENTRY_PRIVACY,
  includeLocalVariables: false,
};
