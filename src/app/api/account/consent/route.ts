import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { TERMS_VERSION } from "@/lib/legal/terms";
import { log } from "@/lib/observability/log";

// An existing account confirming it is 18+ and accepting the current Terms
// and Privacy Policy (Alon, 2026-10-09). New accounts do this at sign-up,
// where migration 0061's trigger records it.
//
// The service-role client, because the consent columns have NO write grant
// for `authenticated` -- that is what stops a user editing or clearing their
// own record. The row is chosen by the header user id only, and this is a
// FIXED path, as every service-role route must be (SECURITY.md).

const bodySchema = z
  .object({
    age_confirmed: z.literal(true),
    // Must be the version on screen now, so a stale tab cannot record
    // agreement to wording it never showed.
    accepted_terms_version: z.literal(TERMS_VERSION),
  })
  .strict();

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await enforceRateLimit(`consent:${userId}`, 10, 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Please tick the box to confirm." }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "This isn't configured on the server yet." }, { status: 503 });
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("user_settings")
    .update({ age_confirmed_at: now, terms_accepted_at: now, terms_version: TERMS_VERSION })
    .eq("user_id", userId);
  if (error) {
    log.error("consent.update_failed", { userId, error });
    return NextResponse.json({ error: "Could not save that. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
