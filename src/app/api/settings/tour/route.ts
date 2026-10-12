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
  // Only worked out for someone who hasn't seen the first tour: everyone else
  // is past the point where the demo question could be asked.
  const offerDemo = settings.has_completed_tour
    ? false
    : shouldOfferDemo({
        demoState: await getDemoState(supabase, userId).catch(() => "unavailable" as const),
        hasTrades: await hasAnyTrades(supabase).catch(() => true),
        hasCompletedTour: settings.has_completed_tour,
      });
  return NextResponse.json({
    hasCompletedTour: settings.has_completed_tour,
    // Phase 4D: ask "Start with a demo journal?" before the welcome.
    offerDemo,
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
