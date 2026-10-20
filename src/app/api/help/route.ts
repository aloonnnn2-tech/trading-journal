import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { clientIpKey, rateLimit } from "@/lib/rate-limit";
import { emailKey, readJson } from "@/lib/auth/server-auth";
import { parseHelpRequest } from "@/lib/help/schema";
import { verifyCaptcha } from "@/lib/help/turnstile-verify";
import { HELP_CAPTCHA_ACTION, HELP_EMAIL, HELP_LIMITS } from "@/lib/help/config";
import { isMissingTableError } from "@/lib/supabase/errors";
import { isRowLimitError } from "@/lib/limits";
import { log } from "@/lib/observability/log";

// The "Get help" form (/help). Open to anyone, signed in or not -- the people
// who most need it are the ones who can't sign in. It only ever stores a
// message: nothing here reads or changes an account, so the risks are spam
// and flooding, and these are the layers against them, outermost first:
//
//  1. The proxy: cross-site posts refused, 60/min per IP when signed out,
//     body size capped.
//  2. Limits here: per IP, per email address (hashed), per signed-in
//     account, and a ceiling for the whole site per day.
//  3. The robot check, for everyone (Alon, 2026-10-20), verified by OUR
//     server with Cloudflare (src/lib/help/turnstile-verify.ts). In
//     production a missing secret refuses the form rather than skip it.
//  4. A honeypot field: a bot that fills it is told "sent"; nothing stored.
//  5. Strict validation (src/lib/help/schema.ts) and the table's own checks,
//     service-role-only access and a ceiling on its size (0075).

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const UNAVAILABLE = `The help form isn't available right now. Email us at ${HELP_EMAIL} instead.`;

function tooMany(retryAfterSeconds: number): Response {
  return NextResponse.json(
    { error: `That's a lot of messages in a short time. Wait a while, or email us at ${HELP_EMAIL}.` },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function POST(request: Request) {
  const parsed = parseHelpRequest(await readJson(request));
  if (parsed.kind === "honeypot") return NextResponse.json({ ok: true });
  if (parsed.kind === "invalid") return NextResponse.json({ error: parsed.message }, { status: 400 });
  const { email, name, topic, message, page, captchaToken } = parsed.data;

  // Verified by the proxy, never taken from the body.
  const userId = await getUserIdFromHeader();
  const ip = clientIpKey(request.headers);

  // Limits before the robot check, so a flood can't make us call Cloudflare
  // without end either. The site-wide ceiling is last: an IP or address
  // that's already over its own limit doesn't use up everyone's.
  const checks: [string, number, number][] = [
    [`help:ip:${ip}`, HELP_LIMITS.perIpPerHour, HOUR],
    [`help:email:${emailKey(email)}`, HELP_LIMITS.perEmailPerHour, HOUR],
    ...(userId ? ([[`help:user:${userId}`, HELP_LIMITS.perAccountPerDay, DAY]] as [string, number, number][]) : []),
    ["help:site", HELP_LIMITS.sitePerDay, DAY],
  ];
  for (const [key, limit, windowMs] of checks) {
    const result = await rateLimit(key, limit, windowMs);
    if (!result.ok) return tooMany(result.retryAfterSeconds);
  }

  const verdict = await verifyCaptcha(captchaToken, {
    ip,
    action: HELP_CAPTCHA_ACTION,
    hostname: new URL(request.url).hostname,
  });
  if (!verdict.ok) {
    if (verdict.reason === "not_configured") {
      log.error("help.captcha_not_configured", { fix: "set TURNSTILE_SECRET_KEY" });
      return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
    }
    if (verdict.reason === "unavailable") {
      return NextResponse.json({ error: "The security check couldn't be reached. Try again in a moment." }, { status: 503 });
    }
    log.warn("help.captcha_refused", { reason: verdict.reason });
    return NextResponse.json(
      { error: "The security check didn't pass. Tick the box again, then send." },
      { status: 400 },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }
  const { error } = await admin
    .from("help_requests")
    .insert({ user_id: userId, email, name, topic, message, page });
  if (error) {
    if (isMissingTableError(error)) {
      log.error("help.table_missing", { fix: "apply migration 0075_help_requests.sql" });
      return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
    }
    if (isRowLimitError(error)) {
      log.error("help.table_full", {});
      return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
    }
    log.error("help.insert_failed", { error });
    return NextResponse.json({ error: UNAVAILABLE }, { status: 500 });
  }

  // No email or message in the log: those are the person's, not ours to copy.
  log.info("help.request_received", { topic, signedIn: Boolean(userId) });
  return NextResponse.json({ ok: true });
}
