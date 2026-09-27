import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIpKey, enforceRateLimit } from "@/lib/rate-limit";
import { parseWaitlistRequest } from "@/lib/waitlist/validate";

// The paid-plan waitlist's only writer (Phase 2B of docs/design-audit.md).
// Anonymous by design: the people joining do not have accounts.
//
// Layers, outermost first:
//  1. The proxy (src/proxy.ts): 60/min per IP for anonymous /api calls, and a
//     refusal of cross-site POSTs.
//  2. This route's own limit, 5 signups per IP per hour, on the same global
//     Postgres-backed limiter. Counted only for requests that would be
//     stored: a person who mistypes their address five times should get a
//     sixth try, and the rejections cost nothing -- no database -- and are
//     already bounded by the proxy's limit.
//  3. The honeypot (src/lib/waitlist/validate.ts). A filled trap gets the
//     same answer as a real signup and nothing is stored.
//  4. The table itself (migration 0050): service role only, RLS on with no
//     policies, grants revoked, and one row per address case-insensitively.
//
// Every successful outcome -- stored, already on the list, honeypot -- is the
// same 200 { ok: true }. A different answer for "already on the list" would
// let anyone test whether an address is on it.

const LIMIT_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;

/** Postgres: a row with this lower(email) already exists. */
const UNIQUE_VIOLATION = "23505";
/** The table isn't there -- migration 0050 not applied yet. Two codes, because
 *  PostgREST rejects an insert into an unknown table itself (PGRST205, "could
 *  not find the table in the schema cache") before Postgres would ever say
 *  42P01. Seen against the live project before 0050 existed; the same
 *  read-vs-write split as isMissingColumnError in src/lib/settings/queries.ts. */
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseWaitlistRequest(body);
  if (parsed.kind === "honeypot") return NextResponse.json({ ok: true });
  if (parsed.kind === "invalid") {
    return NextResponse.json({ error: parsed.reason === "email" ? "Invalid email" : "Invalid request" }, { status: 400 });
  }

  const limited = await enforceRateLimit(
    `waitlist:${clientIpKey(request.headers)}`,
    LIMIT_PER_HOUR,
    HOUR_MS,
    "That's a few too many tries from here. Wait a while and try again.",
  );
  if (limited) return limited;

  const { error } = await createAdminClient()
    .from("waitlist")
    .insert({ email: parsed.email, source: parsed.source });

  if (!error || error.code === UNIQUE_VIOLATION) return NextResponse.json({ ok: true });

  if (MISSING_TABLE.has(error.code)) {
    console.error("waitlist: table missing -- apply migration 0050_waitlist.sql");
    return NextResponse.json({ error: "Waitlist unavailable" }, { status: 503 });
  }

  console.error("waitlist: insert failed:", error.code, error.message);
  return NextResponse.json({ error: "Could not save" }, { status: 500 });
}
