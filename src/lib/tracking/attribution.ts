// Where a sign-up came from (outside review, 2026-11-14: seven sign-ups and no
// way to tell which post or link brought any of them).
//
// Deliberately small and private by construction:
//  - Nothing is sent anywhere while someone is just browsing. The first visit's
//    UTM tags and referring site are kept in this tab's session storage
//    (cleared when the tab closes) and only travel with the sign-up request,
//    where the visitor has chosen to make an account.
//  - Only short, plain tags and a referring HOST are kept. Never a full
//    referring URL, a path or a query string, which can hold anything.

export interface Attribution {
  source?: string;
  medium?: string;
  campaign?: string;
  /** The referring site's host, e.g. "t.co". Never a path or query. */
  referrer?: string;
}

export const ATTRIBUTION_KEY = "tl-attribution";

const TAG = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function tag(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // "TikTok Bio" arrives as tiktok-bio in the report, not as two spellings.
  const t = value.trim().toLowerCase().replace(/\s+/g, "-");
  return TAG.test(t) ? t : undefined;
}

function host(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  let h: string;
  try {
    h = new URL(value).hostname.toLowerCase();
  } catch {
    // Already a bare host (what the stored copy holds).
    h = value.trim().toLowerCase();
  }
  h = h.replace(/^www\./, "");
  return /^[a-z0-9.-]{1,100}$/.test(h) && h.includes(".") ? h : undefined;
}

function compact(a: Attribution): Attribution | null {
  const out: Attribution = {};
  if (a.source) out.source = a.source;
  if (a.medium) out.medium = a.medium;
  if (a.campaign) out.campaign = a.campaign;
  if (a.referrer) out.referrer = a.referrer;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * What this page load says about where the visitor came from. `ownHost` is
 * this site's host: moving between our own pages is not a referral.
 */
export function attributionFromVisit(search: string, referrer: string, ownHost: string): Attribution | null {
  const params = new URLSearchParams(search);
  const ref = host(referrer);
  const own = host(`https://${ownHost}`);
  return compact({
    source: tag(params.get("utm_source")),
    medium: tag(params.get("utm_medium")),
    campaign: tag(params.get("utm_campaign")),
    referrer: ref && ref !== own ? ref : undefined,
  });
}

/** Validates anything claiming to be an attribution (the sign-up request body). */
export function cleanAttribution(input: unknown): Attribution | null {
  if (typeof input !== "object" || input === null) return null;
  const o = input as Record<string, unknown>;
  return compact({
    source: tag(o.source),
    medium: tag(o.medium),
    campaign: tag(o.campaign),
    referrer: host(o.referrer),
  });
}

/** The account-metadata keys a sign-up stores them under. */
export function attributionMetadata(a: Attribution | null): Record<string, string> {
  if (!a) return {};
  const out: Record<string, string> = {};
  if (a.source) out.signup_source = a.source;
  if (a.medium) out.signup_medium = a.medium;
  if (a.campaign) out.signup_campaign = a.campaign;
  if (a.referrer) out.signup_referrer = a.referrer;
  return out;
}

/** Browser: keep the FIRST visit's attribution for this tab. Never throws. */
export function rememberAttribution(): void {
  try {
    if (sessionStorage.getItem(ATTRIBUTION_KEY) !== null) return;
    const found = attributionFromVisit(window.location.search, document.referrer, window.location.host);
    if (found) sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(found));
  } catch {
    // Blocked storage: the sign-up simply carries no source.
  }
}

/** Browser: what rememberAttribution kept, re-validated. Never throws. */
export function readAttribution(): Attribution | null {
  try {
    const raw = sessionStorage.getItem(ATTRIBUTION_KEY);
    return raw ? cleanAttribution(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
