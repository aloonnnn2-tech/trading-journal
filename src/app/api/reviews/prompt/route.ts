import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getMyReview, getPromptState } from "@/lib/reviews/queries";
import { mayAsk, reviewTrigger, snoozeUntil } from "@/lib/reviews/prompt";

// Whether to ask this user for a review now (src/lib/reviews/prompt.ts),
// and their answer to being asked. GET is called once per browser session;
// PATCH records that the card was shown, "Not now" or "Don't ask again".

export async function GET() {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const state = await getPromptState(supabase, userId);
  // 0064 not applied: never ask.
  if (!state || state.excluded_from_analytics) return NextResponse.json({ trigger: null, mayAsk: false });

  const review = await getMyReview(supabase, userId);
  const base = {
    hasReview: review !== null,
    dismissed: state.review_prompt_dismissed,
    snoozedUntil: state.review_prompt_snoozed_until,
    timesAsked: state.review_prompt_count,
  };
  if (!mayAsk(base)) return NextResponse.json({ trigger: null, mayAsk: false });

  const [{ count: closedTrades }, { data: auth }] = await Promise.all([
    supabase.from("trades").select("id", { count: "exact", head: true }).eq("status", "closed"),
    supabase.auth.getUser(),
  ]);

  // Visits live in analytics_sessions, which a user can't read (0013): the
  // service-role client, filtered to this user only -- the same as the data
  // download. Unknown counts as none, which can only delay an ask.
  let visits = 0;
  try {
    const { count } = await createAdminClient()
      .from("analytics_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    visits = count ?? 0;
  } catch {
    visits = 0;
  }

  const trigger = reviewTrigger({
    ...base,
    closedTrades: closedTrades ?? 0,
    accountCreatedAt: auth.user?.created_at ?? null,
    visits,
  });
  return NextResponse.json({ trigger, mayAsk: true });
}

const bodySchema = z.object({ action: z.enum(["shown", "snoozed", "dismissed"]) }).strict();

export async function PATCH(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await enforceRateLimit(`review-prompt:${userId}`, 20, 60_000);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Expected { action }" }, { status: 400 });

  const supabase = await createClient();
  const state = await getPromptState(supabase, userId);
  if (!state) return NextResponse.json({ ok: true, stored: false });

  const update =
    parsed.data.action === "shown"
      ? { review_prompt_count: Math.min(state.review_prompt_count + 1, 100) }
      : parsed.data.action === "snoozed"
        ? { review_prompt_snoozed_until: snoozeUntil() }
        : { review_prompt_dismissed: true };
  const { error } = await supabase.from("user_settings").update(update).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  return NextResponse.json({ ok: true, stored: true });
}
