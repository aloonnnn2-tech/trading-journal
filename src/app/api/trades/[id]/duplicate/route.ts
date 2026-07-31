import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { duplicateTrade } from "@/lib/trades/queries";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // duplicateTrade throws when the id doesn't exist (or belongs to another
  // user and RLS filtered it out) -- that's a 404, not an unhandled 500.
  let duplicate;
  try {
    duplicate = await duplicateTrade(supabase, id);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  void logEvent(supabase, userData.user.id, SERVER_SESSION_ID, "trade_created", {
    tradeId: duplicate.id,
    source: "duplicate",
  });
  return NextResponse.json(duplicate, { status: 201 });
}
