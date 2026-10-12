import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIpKey, enforceRateLimit } from "@/lib/rate-limit";

// Anonymous page-view counter for the public pages. This is the ONE piece of
// analytics that runs for logged-out visitors, and it is built to store
// nothing about them: the request carries only a path, and record_public_view
// (migration 0043) increments one integer per (day, path). No cookie is set,
// no session id or IP is recorded with the count, nothing is read from the
// device. That is what keeps it outside the consent question the privacy
// policy rests on.
//
// Deliberately unauthenticated -- there is no user to attribute a homepage
// visit to, which is the point. Abuse can only inflate a counter, and two
// things bound it (full check 2026-10-12, finding N-3):
//   - record_public_view is callable by the service role only (0068). Before
//     that, anyone could call it straight through Supabase with the public
//     anon key, skipping every limit here -- unbounded from one machine.
//   - its own per-IP limit, on top of the proxy's general one. The IP is only
//     a short-lived rate-limit bucket key, exactly as the proxy already uses
//     it for every anonymous API call; it is never stored with the count.
// A visitor reading every public page and refreshing a few times stays far
// below the limit. Someone rotating IP addresses can still add views; ruling
// that out would mean recognising visitors, which this counter exists to
// avoid.
const VIEWS_PER_IP = 60;
const VIEW_WINDOW_MS = 60 * 60 * 1000;

// Mirrors the allowlist inside record_public_view. Kept as an enum here too
// so a bad path is a clean 400 before it ever reaches the database.
const TRACKED = ["/", "/paid-plan", "/privacy", "/terms", "/cookies", "/contact"] as const;

const bodySchema = z.object({ path: z.enum(TRACKED) });

export async function POST(request: Request) {
  const limited = await enforceRateLimit(`public-view:${clientIpKey(request.headers)}`, VIEWS_PER_IP, VIEW_WINDOW_MS);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Path not tracked" }, { status: 400 });
  }

  // A beacon never reads its response, so a failure (a missing service-role
  // key, or the database refusing) is logged server-side and answered
  // quietly. It must never surface as an error on a marketing page.
  try {
    const { error } = await createAdminClient().rpc("record_public_view", { p_path: parsed.data.path });
    if (error) console.warn("public-view: record failed:", error.message);
  } catch (err) {
    console.warn("public-view: record failed:", err instanceof Error ? err.message : err);
  }

  return new NextResponse(null, { status: 204 });
}
