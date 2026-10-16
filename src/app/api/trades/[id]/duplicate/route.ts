import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { duplicateTrade } from "@/lib/trades/queries";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import { withIdempotency } from "@/lib/http/idempotency";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same ceiling as creating a trade: it is one.
  const limited = await enforceRateLimit(
    `trades-create:${userId}`,
    60,
    60_000,
    "You're creating trades faster than we can keep up. Wait a moment and try again.",
  );
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
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    void logEvent(userId, SERVER_SESSION_ID, "trade_created", {
      tradeId: duplicate.id,
      source: "duplicate",
    });
    return NextResponse.json(duplicate, { status: 201 });
  });
}
