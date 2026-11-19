import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import {
  getUserSettings,
  isMissingColumnError,
  setPaidTourDismissed,
  setPaidTourSnoozed,
  setTourCompleted,
} from "@/lib/settings/queries";
import { isPaidUser } from "@/lib/settings/plan";
import { getDemoState, hasAnyTrades } from "@/lib/demo/queries";
import { shouldOfferDemo } from "@/lib/demo/state";
import { demoKeepsOwnTrades } from "@/lib/demo/keeps-own-trades";
import { shouldAskHeardFrom } from "@/lib/onboarding/heard-from";

// A snooze hides the offer until a real instant, never absurdly far off (the
// client snoozes for days, not years).
const UNTIL = z
  .string()
  .max(40)
  .refine((v) => {
    const t = Date.parse(v);
    return Number.isFinite(t) && t < Date.now() + 400 * 24 * 60 * 60 * 1000;
  }, "Bad until");

const bodySchema = z
  .discriminatedUnion("paidOffer", [
    z.object({ paidOffer: z.literal("dismissed"), until: z.unknown().optional() }).strict(),
    z.object({ paidOffer: z.literal("snoozed"), until: UNTIL }).strict(),
  ])
  .nullable();

export async function GET() {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const settings = await getUserSettings(supabase, userId);
  // First run (Alon, 2026-11-19): welcome card with the demo-data question,
  // "How did you hear about us?", then "Log your first trade" for an account
  // with no trades yet. All of it is only worked out while first run is still
  // ahead. A failed trade count reads as "has trades": better to skip the
  // first-trade screen than to show it over a journal that exists.
  const hasTrades = settings.has_completed_tour ? true : await hasAnyTrades(supabase).catch(() => true);
  const firstTrade = !settings.has_completed_tour && !hasTrades;
  const offerDemo = settings.has_completed_tour
    ? false
    : shouldOfferDemo({
        demoState: await getDemoState(supabase, userId).catch(() => "unavailable" as const),
        hasTrades,
        hasCompletedTour: settings.has_completed_tour,
      });
  // Choosing demo data still leads to "Log your first trade" once the demo
  // keeps the user's own trades (0082); before that it would be deleted with
  // the demo, so demo users skip the screen.
  const demoKeepsTrades = offerDemo ? await demoKeepsOwnTrades(supabase) : false;
  // A failed lookup means "don't ask".
  const askHeardFrom = settings.has_completed_tour
    ? false
    : await supabase.auth
        .getUser()
        .then(({ data }) => (data.user ? shouldAskHeardFrom(false, data.user.user_metadata) : false))
        .catch(() => false);
  return NextResponse.json({
    hasCompletedTour: settings.has_completed_tour,
    offerDemo,
    demoKeepsTrades,
    askHeardFrom,
    firstTrade,
    isPaid: isPaidUser(settings),
    // Null on both means migration 0049 has not been applied: the client
    // falls back to localStorage rather than reading a missing column as
    // "the user has not answered", which would re-offer the tour forever.
    paidTourDismissed: settings.paid_tour_dismissed,
    paidTourSnoozedUntil: settings.paid_tour_snoozed_until,
    paidTourStateStored: settings.paid_tour_dismissed !== null,
  });
}

export async function PATCH(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // No body: the original meaning of this route, "the welcome tour is done".
  // Kept exactly as it was so the existing caller needs no change.
  // An empty body is the original call: "the welcome tour is done".
  const text = await request.text().catch(() => "");
  let rawBody: unknown = null;
  if (text.trim()) {
    try {
      rawBody = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected no body, or { paidOffer, until }" }, { status: 400 });
  }
  const body = parsed.data;

  if (body) {
    try {
      if (body.paidOffer === "dismissed") {
        await setPaidTourDismissed(supabase, userId);
      } else {
        await setPaidTourSnoozed(supabase, userId, body.until);
      }
    } catch (error) {
      // The columns are not there yet (0049 unapplied). The client has already
      // written its localStorage fallback, so this is not a failure worth
      // surfacing: report that nothing was stored server-side and let it
      // stand.
      if (isMissingColumnError(error)) {
        return NextResponse.json({ ok: true, stored: false });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, stored: true });
  }

  await setTourCompleted(supabase, userId);
  return NextResponse.json({ ok: true });
}
