import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createBlankTrade } from "@/lib/trades/queries";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";

export async function POST() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const trade = await createBlankTrade(supabase, userData.user.id);
  void logEvent(supabase, userData.user.id, SERVER_SESSION_ID, "trade_created", { tradeId: trade.id });

  return NextResponse.json(trade, { status: 201 });
}
