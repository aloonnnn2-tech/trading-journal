import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { getTrade } from "@/lib/trades/queries";
import { DETECTED_LABELS } from "@/lib/mistakes/analyze";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import {
  MISTAKE_FIELD_KEY,
  dismissedLabels,
  taggedLabels,
} from "@/lib/mistakes/trade-suggestions";

// Accepting or turning down a suggested tag.
//
// **Why this is not the ordinary trade PATCH.** Accepting a suggestion is a
// read-modify-write of one array inside custom_fields, and the trade form
// autosaves the whole of custom_fields every 600ms while it is open. Routing
// the accept through that path would put the two writers in a race whose loser
// silently drops the other's edit. Here the merge happens server-side against
// the row as it stands, so the worst case is an accept landing a moment after
// an edit rather than instead of it.
//
// It also keeps the surface honest: this route accepts nothing but a label the
// app itself detected, so it can never be used to write arbitrary strings into
// the journal.
//
// Both branches are a read-modify-write of one array, so an autosave landing
// between the read and the write can still lose the accept. PostgREST cannot
// express an atomic `custom_fields || jsonb_build_object(...)` without an RPC,
// and the trade form has always had the same property, so this matches the
// existing behaviour rather than inventing a stricter one for one button.

const bodySchema = z.object({
  // An enum, not a string. The client is telling us which suggestion was
  // clicked -- it is not supplying journal content.
  label: z.enum(Object.values(DETECTED_LABELS) as [string, ...string[]]),
  action: z.enum(["accept", "dismiss"]),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // RLS-scoped, so a foreign id is a 404 rather than a 403 -- the same
  // non-enumerable posture as the rest of the trade routes.
  const trade = await getTrade(supabase, id);
  if (!trade) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { label, action } = parsed.data;

  if (action === "accept") {
    const existing = taggedLabels(trade);
    // Already there: nothing to do. Appending blindly would duplicate the tag
    // on a double click, and the field is a plain string array with no
    // uniqueness of its own.
    if (existing.includes(label)) {
      return NextResponse.json({ ok: true, labels: existing });
    }

    const labels = [...existing, label];

    // **Not updateTrade().** That helper re-resolves commission from the
    // user's current rules and recomputes every derived money column on any
    // call, including one that touches nothing but custom_fields. It is the
    // right behaviour for the trade form -- an edit to price or size should
    // pick up the fee -- but it is the wrong behaviour here: accepting a
    // suggested tag is a one-click action, and a user clicking "Add tag"
    // cannot reasonably expect the trade's P&L to be rewritten underneath
    // them. Measured on the journal this was built against, a re-derive today
    // would change the stored commission, and therefore dollar_pl, on 44 of
    // 327 closed trades.
    //
    // So this writes the one jsonb key and nothing else. The trade's numbers
    // are exactly what they were before the click, which is the guarantee the
    // panel makes in as many words.
    const { error } = await supabase
      .from("trades")
      .update({ custom_fields: { ...trade.custom_fields, [MISTAKE_FIELD_KEY]: labels } })
      .eq("id", id);

    if (error) {
      console.error("accept suggestion failed", { tradeId: id, error });
      return NextResponse.json({ error: "Failed to add the tag" }, { status: 400 });
    }
    void logEvent(supabase, userId, SERVER_SESSION_ID, "trade_edited", { tradeId: id });
    return NextResponse.json({ ok: true, labels });
  }

  const existing = dismissedLabels(trade);
  if (existing.includes(label)) {
    return NextResponse.json({ ok: true, dismissed: existing });
  }

  const dismissed = [...existing, label];
  // Written directly rather than through updateTrade: this is housekeeping,
  // not journal data, and updateTrade recomputes the trade's derived P&L
  // columns on every call. Dismissing a suggestion must not touch a number.
  const { error } = await supabase
    .from("trades")
    .update({ dismissed_suggestions: dismissed })
    .eq("id", id);

  if (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json(
        {
          error:
            "Dismissing suggestions needs migration 0037, which has not been applied to this database yet.",
        },
        { status: 503 },
      );
    }
    console.error("dismiss suggestion failed", { tradeId: id, error });
    return NextResponse.json({ error: "Failed to dismiss the suggestion" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, dismissed });
}
