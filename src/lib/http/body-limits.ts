/**
 * Request-size ceilings for /api, checked in src/proxy.ts before any route
 * runs (security hardening, Phase 2). Without them every handler buffers
 * whatever arrives -- `request.json()` and `request.formData()` read the
 * whole body before a single validation rule sees it.
 *
 * Two tiers. Uploads and imports legitimately carry megabytes: a 5 MB
 * screenshot or spreadsheet (the routes' own MAX_BYTES) plus multipart
 * overhead, or up to 20,000 import rows as JSON. Everything else is a form
 * field or a small JSON object, where 1 MB is already orders of magnitude
 * past real use. 6 MB matches Netlify's own function body limit, so the
 * large tier never refuses anything the platform would have accepted.
 *
 * This reads Content-Length, which browsers always send for fetch bodies. A
 * chunked request without one passes here and is bounded by the platform's
 * 6 MB limit and by the routes that read with readJsonLimited.
 */

export const DEFAULT_BODY_LIMIT = 1024 * 1024; // 1 MB
export const LARGE_BODY_LIMIT = 6 * 1024 * 1024; // 6 MB

const LARGE_BODY_ROUTES: RegExp[] = [
  /^\/api\/ocr\/parse$/,
  /^\/api\/trades\/[^/]+\/images$/,
  /^\/api\/trades\/import(?:-json)?$/,
  /^\/api\/trades\/import\/parse-xlsx$/,
];

export function bodyLimitFor(pathname: string): number {
  return LARGE_BODY_ROUTES.some((re) => re.test(pathname)) ? LARGE_BODY_LIMIT : DEFAULT_BODY_LIMIT;
}

/** True when the declared size is over the limit for this path. */
export function declaredBodyTooLarge(pathname: string, contentLength: string | null): boolean {
  if (contentLength == null || contentLength === "") return false;
  const declared = Number(contentLength);
  // A malformed length is refused rather than guessed at.
  if (!Number.isFinite(declared) || declared < 0) return true;
  return declared > bodyLimitFor(pathname);
}
