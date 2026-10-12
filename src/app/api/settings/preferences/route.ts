import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isMissingColumnError } from "@/lib/settings/queries";
import { setShowTradeSummary } from "@/lib/settings/trade-summary";
import { preferencesPatchSchema } from "@/lib/settings/preferences-schema";
import { savePreferences } from "@/lib/settings/preferences-queries";

// Setup -> Settings. Two stores behind one route:
//  - showTradeSummary: its own column (migration 0052);
//  - preferences: every other switch, one validated jsonb object (0054).
// A body may carry either or both; each is saved independently, so a pending
// migration for one never blocks the other.

const bodySchema = z
  .object({
    showTradeSummary: z.boolean().optional(),
    preferences: preferencesPatchSchema.optional(),
  })
  .strict()
  .refine((b) => b.showTradeSummary !== undefined || (b.preferences && Object.keys(b.preferences).length > 0), {
    message: "Nothing to change",
  });

export async function PATCH(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(`preferences:${userId}`, 30, 60_000, "Too many changes in a row. Wait a moment and try again.");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  }
  const { showTradeSummary, preferences } = parsed.data;

  const supabase = await createClient();
  const result: { ok: true; showTradeSummary?: boolean; preferences?: unknown } = { ok: true };
  try {
    if (showTradeSummary !== undefined) {
      await setShowTradeSummary(supabase, userId, showTradeSummary);
      result.showTradeSummary = showTradeSummary;
    }
    if (preferences) result.preferences = await savePreferences(supabase, userId, preferences);
  } catch (error) {
    // 0052 or 0054 isn't applied: nothing to save it in yet.
    if (isMissingColumnError(error)) {
      return NextResponse.json({ error: "This setting isn't available yet." }, { status: 503 });
    }
    throw error;
  }
  return NextResponse.json(result);
}
