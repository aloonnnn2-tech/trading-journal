import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { deleteMyReview, getMyReview, getPromptState, isMissingReviews, saveMyReview } from "@/lib/reviews/queries";
import { reviewInputSchema } from "@/lib/reviews/schema";

// The caller's own review of Trading Lens (migration 0064): read, write or
// remove. Only ever their own row -- the RLS client and the user id from the
// auth header, nothing from the request body.

async function caller(): Promise<{ userId: string; response: null } | { userId: null; response: NextResponse }> {
  const userId = await getUserIdFromHeader();
  if (!userId) return { userId: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { userId, response: null };
}

export async function GET() {
  const who = await caller();
  if (who.response) return who.response;
  const userId = who.userId;
  const review = await getMyReview(await createClient(), userId);
  return NextResponse.json({ review });
}

export async function PUT(request: Request) {
  const who = await caller();
  if (who.response) return who.response;
  const userId = who.userId;
  const limited = await enforceRateLimit(`reviews:${userId}`, 10, 60_000);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = reviewInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose 1 to 5 stars. A comment is up to 1000 characters, a name up to 40." }, { status: 400 });
  }

  const supabase = await createClient();
  // The demo account and test accounts (excluded_from_analytics, 0044) can't
  // review: they're ours, not real users, so a review from one would be one
  // we wrote ourselves. (The demo's password is no longer public -- new
  // accounts get their own demo journal -- but it's still not a real user.)
  if ((await getPromptState(supabase, userId).catch(() => null))?.excluded_from_analytics) {
    return NextResponse.json({ error: "Reviews can't be left from the shared demo account." }, { status: 403 });
  }
  try {
    const review = await saveMyReview(supabase, userId, parsed.data);
    void logEvent(userId, SERVER_SESSION_ID, "review_submitted", {
      rating: parsed.data.rating,
      allowPublic: parsed.data.allowPublic,
      source: parsed.data.source,
    });
    return NextResponse.json({ review });
  } catch (error) {
    if (isMissingReviews(error)) {
      return NextResponse.json({ error: "Reviews aren't switched on yet." }, { status: 503 });
    }
    console.error("[reviews] save failed:", (error as { code?: string })?.code ?? error);
    return NextResponse.json({ error: "Couldn't save your review. Try again." }, { status: 500 });
  }
}

export async function DELETE() {
  const who = await caller();
  if (who.response) return who.response;
  const userId = who.userId;
  const limited = await enforceRateLimit(`reviews:${userId}`, 10, 60_000);
  if (limited) return limited;
  await deleteMyReview(await createClient(), userId);
  return NextResponse.json({ ok: true });
}
