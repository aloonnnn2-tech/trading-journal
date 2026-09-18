import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Anonymous page-view counter for the public pages. This is the ONE piece of
// analytics that runs for logged-out visitors, and it is built to store
// nothing about them: the request carries only a path, and record_public_view
// (migration 0043) increments one integer per (day, path). No cookie is set,
// no session id or IP is recorded, nothing is read from the device. That is
// what keeps it outside the consent question the privacy policy rests on.
//
// Deliberately unauthenticated -- there is no user to attribute a homepage
// visit to, which is the point. Abuse can only inflate a counter, and the
// proxy's anonymous per-IP rate limit (60/min) bounds how fast.

// Mirrors the allowlist inside record_public_view. Kept as an enum here too
// so a bad path is a clean 400 before it ever reaches the database.
const TRACKED = ["/", "/paid-plan", "/privacy", "/terms", "/cookies", "/contact"] as const;

const bodySchema = z.object({ path: z.enum(TRACKED) });

export async function POST(request: Request) {
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

  // Cookie-bound client with no session resolves to the anon role, which is
  // exactly who record_public_view is granted to.
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_public_view", { p_path: parsed.data.path });

  // A beacon never reads its response, so a failure (most likely: migration
  // 0043 not yet applied) is logged server-side and answered quietly. It must
  // never surface as an error on a marketing page.
  if (error) console.warn("public-view: record failed:", error.message);

  return new NextResponse(null, { status: 204 });
}
