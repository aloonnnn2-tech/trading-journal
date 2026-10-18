import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { duplicateTrade } from "@/lib/trades/queries";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { enforceTradeCreateLimits } from "@/lib/trades/create-limits";
import { rowLimitResponse } from "@/lib/limits";
import { withIdempotency } from "@/lib/http/idempotency";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Per-minute and hourly: src/lib/trades/create-limits.ts.
  const limited = await enforceTradeCreateLimits(userId);
  if (limited) return limited;

  // A repeated click (same Idempotency-Key) gets the first copy back
  // instead of making another. See src/lib/http/idempotency.ts.
  return withIdempotency(request, userId, `trades.duplicate:${id}`, async () => {
    const supabase = await createClient();

    // duplicateTrade throws when the id doesn't exist (or belongs to another
    // user and RLS filtered it out) -- that's a 404, not an unhandled 500.
    let duplicate;
    try {
      duplicate = await duplicateTrade(supabase, id);
    } catch (err) {
      const limited = rowLimitResponse(err);
      if (limited) return limited;
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    void logEvent(userId, SERVER_SESSION_ID, "trade_created", {
      tradeId: duplicate.id,
      source: "duplicate",
    });
    return NextResponse.json(duplicate, { status: 201 });
  });
}
