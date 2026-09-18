import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { isAdmin, setUserExcluded } from "@/lib/tracking/admin-queries";
import { enforceRateLimit } from "@/lib/rate-limit";

// Toggles whether one account's activity counts toward admin analytics
// (migration 0044). Same authorization shape as /api/admin/plan: the caller
// is re-derived from the auth header and proven an admin against the RLS
// client before anything in the body is trusted, and the body only ever
// names *whose* row to change.
//
// Unlike /api/admin/plan this never needs a service-role client -- the write
// goes through admin_set_user_excluded(), a security-definer RPC that
// rechecks is_admin itself (0044), so the RLS-scoped client is sufficient.

const bodySchema = z.object({
  userId: z.uuid("userId must be a user id"),
  excluded: z.boolean(),
});

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin-gated below, but a limit here bounds what a leaked admin session
  // could do at machine speed, same reasoning as admin-plan.
  const limited = await enforceRateLimit(
    `admin-exclusion:${userId}`,
    60,
    60_000,
    "Too many changes in a row. Wait a moment and try again.",
  );
  if (limited) return limited;

  const supabase = await createClient();
  if (!(await isAdmin(supabase, userId))) {
    // 403, not 404: this route's existence isn't a secret.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  await setUserExcluded(supabase, parsed.data.userId, parsed.data.excluded);

  return NextResponse.json({ ok: true, excluded: parsed.data.excluded });
}
