/**
 * Collector for Content-Security-Policy violation reports.
 *
 * **Why this exists.** src/proxy.ts has sent a nonce-based CSP in
 * Report-Only mode for some time, and Report-Only means "report instead of
 * block" -- but with nowhere to report TO, every violation went to a browser
 * console on a machine nobody was watching. The rollout was therefore
 * collecting nothing: not "no violations", but no information at all. Flipping
 * to enforcing on that basis would be a guess, and the thing it would break is
 * sign-in.
 *
 * This gives the policy somewhere to report, so the flip can be made on
 * evidence. It is the prerequisite for that change, not part of it.
 *
 * **Deliberately unauthenticated.** Browsers send violation reports as
 * fire-and-forget POSTs with no session and ignore whatever comes back, so
 * there is no caller to authenticate and nothing useful to return. The
 * blanket anonymous limit in src/proxy.ts (60/min per IP) still applies, and
 * REPORT_CAP below bounds what reaches Sentry regardless of that.
 *
 * **Always answers 204, even on garbage.** A browser does not read the status
 * and does not retry, so returning 400 would only mean a route that appears
 * to be erroring in the metrics while changing nothing about what arrives.
 */
import * as Sentry from "@sentry/nextjs";
import { rateLimit } from "@/lib/rate-limit";

// Sentry's Node SDK, and the report bodies can outgrow the edge runtime's
// limits when a policy string is long.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports are small; anything larger is not a browser sending a violation. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Per-signature cap on what reaches Sentry: 5 of any one
 * directive+origin pair per 10 minutes.
 *
 * Without this the endpoint is a Sentry quota tap. One blocked resource on a
 * page fires once per page view, so a single genuinely-broken directive on
 * the dashboard would send a report per load, per user, forever -- thousands
 * of events that all say the identical thing. The fifth copy of a violation
 * tells us nothing the first did not, and the signal we need here is "does
 * this happen at all", not "how often".
 */
const REPORT_CAP = 5;
const REPORT_WINDOW_MS = 10 * 60_000;

/**
 * A violation, whichever wire format it arrived in.
 */
interface Violation {
  directive: string;
  blockedUri: string;
  documentUri: string;
  sourceFile: string;
  lineNumber: number | null;
  sample: string;
  disposition: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Two wire formats, because no single one is supported everywhere.
 *
 *  - `report-uri` posts `application/csp-report` as
 *    `{"csp-report": {"blocked-uri": ..., "effective-directive": ...}}`.
 *    Deprecated, and still the only format Firefox and Safari send.
 *  - The Reporting API (`report-to` / `Reporting-Endpoints`) posts
 *    `application/reports+json` as an ARRAY of `{type, body}`, with camelCase
 *    keys. Chromium-only in practice.
 *
 * proxy.ts advertises both, so this accepts both and flattens them to one
 * shape. A parser written for only the modern one would silently discard
 * every report from Safari -- the browser whose CSP quirks are most likely to
 * be the thing we needed to hear about.
 */
function parseReports(payload: unknown): Violation[] {
  // Reporting API: an array of envelopes, not all of which are CSP.
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (entry): entry is { type?: string; body?: Record<string, unknown> } =>
          typeof entry === "object" && entry !== null,
      )
      .filter((entry) => entry.type === "csp-violation")
      .map((entry) => {
        const body = entry.body ?? {};
        return {
          directive: str(body.effectiveDirective),
          blockedUri: str(body.blockedURL),
          documentUri: str(body.documentURL),
          sourceFile: str(body.sourceFile),
          lineNumber: num(body.lineNumber),
          sample: str(body.sample),
          disposition: str(body.disposition) || "report",
        };
      });
  }

  // report-uri: a single object under a hyphenated key.
  if (typeof payload === "object" && payload !== null && "csp-report" in payload) {
    const body = (payload as { "csp-report": Record<string, unknown> })["csp-report"] ?? {};
    return [
      {
        // `effective-directive` is the specific directive that failed;
        // `violated-directive` can carry the whole source list with it. Prefer
        // the former, fall back for older browsers that only send the latter.
        directive: str(body["effective-directive"]) || str(body["violated-directive"]),
        blockedUri: str(body["blocked-uri"]),
        documentUri: str(body["document-uri"]),
        sourceFile: str(body["source-file"]),
        lineNumber: num(body["line-number"]),
        sample: str(body["script-sample"]),
        disposition: str(body.disposition) || "report",
      },
    ];
  }

  return [];
}

/**
 * Schemes that mean "a browser extension did this, not our code".
 *
 * **This filter is the difference between a usable signal and an unusable
 * one.** Extensions inject scripts and styles into every page their user
 * visits, those injections violate any strict policy, and the page gets the
 * report -- so an unfiltered CSP endpoint mostly measures which extensions
 * this app's users have installed. Password managers, ad blockers, dark-mode
 * themes and translation tools each generate their own steady stream.
 *
 * None of it is actionable: we cannot fix an extension, and no directive
 * change would make these stop. Worse, leaving them in means the one report
 * that matters arrives buried in hundreds that do not, which is how a
 * reporting endpoint ends up ignored.
 */
const EXTENSION_SCHEMES = [
  "chrome-extension:",
  "moz-extension:",
  "safari-extension:",
  "safari-web-extension:",
  "webkit-masked-url:",
  "chrome:",
  "resource:",
  "about:",
];

function isExtensionNoise(violation: Violation): boolean {
  const candidates = [violation.blockedUri, violation.sourceFile, violation.documentUri];
  return candidates.some((value) =>
    EXTENSION_SCHEMES.some((scheme) => value.toLowerCase().startsWith(scheme)),
  );
}

/**
 * Collapses a blocked URI to something stable enough to group on.
 *
 * Sentry groups by fingerprint, and a fingerprint containing a full URL would
 * split one problem across every distinct path or cache-busting query string
 * it happened to be blocked at. The origin is the part that identifies what
 * needs allowing. Keywords like `inline` and `eval` are not URLs at all and
 * pass through as themselves.
 */
function blockedOrigin(blockedUri: string): string {
  if (!blockedUri) return "unknown";
  if (!blockedUri.includes("://")) return blockedUri;
  try {
    return new URL(blockedUri).origin;
  } catch {
    return blockedUri.slice(0, 100);
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length === 0 || raw.length > MAX_BODY_BYTES) return new Response(null, { status: 204 });
    payload = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 204 });
  }

  for (const violation of parseReports(payload)) {
    if (!violation.directive) continue;
    if (isExtensionNoise(violation)) continue;

    const origin = blockedOrigin(violation.blockedUri);

    // Cap per signature, not per request: the same violation arriving from a
    // thousand browsers is still one thing to fix.
    const signature = `csp:${violation.directive}:${origin}`;
    if (!rateLimit(signature, REPORT_CAP, REPORT_WINDOW_MS).ok) continue;

    Sentry.captureMessage(`CSP ${violation.disposition}: ${violation.directive} blocked ${origin}`, {
      level: violation.disposition === "enforce" ? "error" : "warning",
      // Group by what would have to change to fix it. Without an explicit
      // fingerprint Sentry groups on the message, which already varies by
      // origin -- this just makes that intentional rather than incidental.
      fingerprint: ["csp-violation", violation.directive, origin],
      tags: {
        csp_directive: violation.directive,
        csp_blocked_origin: origin,
        csp_disposition: violation.disposition,
      },
      extra: {
        blockedUri: violation.blockedUri,
        documentUri: violation.documentUri,
        sourceFile: violation.sourceFile,
        lineNumber: violation.lineNumber,
        // Present only when the policy asks for it (it does not), but
        // forwarded if a browser sends it anyway. scrubEvent in
        // src/lib/observability/scrub.ts runs over this on the way out.
        sample: violation.sample,
      },
    });
  }

  return new Response(null, { status: 204 });
}
