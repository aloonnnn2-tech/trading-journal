import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { getUserSettings } from "@/lib/settings/queries";
import { isPaidUser } from "@/lib/settings/plan";

export const UPGRADE_MESSAGE = "Upgrade to the paid plan to use this feature.";

type PaidGate =
  | { ok: true; userId: string; supabase: SupabaseClient }
  | { ok: false; response: NextResponse };

/**
 * The auth + paid-plan gate shared by every AI route.
 *
 * Factored out rather than repeated inline (the usual style in this codebase's
 * routes) because it is a security check that must be identical in all four
 * places: three key-management endpoints plus the ask endpoint. Four
 * hand-copied versions is four chances for one of them to drift -- and the one
 * that drifts is the one that hands a free user a paid feature, or worse,
 * skips the auth check entirely.
 *
 * Order matters: 401 before 403, so an unauthenticated caller is never told
 * anything about plans.
 *
 * Callers use the returned `supabase` client rather than making their own. It
 * is the RLS-scoped one, which is what confines every subsequent key query to
 * this user's rows.
 */
export async function requirePaidUser(): Promise<PaidGate> {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const supabase = await createClient();
  const settings = await getUserSettings(supabase, userId);

  if (!isPaidUser(settings)) {
    return {
      ok: false,
      response: NextResponse.json({ error: UPGRADE_MESSAGE }, { status: 403 }),
    };
  }

  return { ok: true, userId, supabase };
}
