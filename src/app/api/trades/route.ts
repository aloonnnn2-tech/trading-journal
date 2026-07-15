import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createBlankTrade } from "@/lib/trades/queries";
import { getAccountBalance } from "@/lib/account/queries";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";

export async function POST() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Position size auto-fills from the cash currently in the account (only
  // once the user has started tracking it). It's an ordinary editable
  // field, so the prefilled value is just a starting point.
  const account = await getAccountBalance(supabase);
  const positionSize =
    account.hasTransactions && account.balance > 0
      ? Math.round(account.balance * 100) / 100
      : null;

  const trade = await createBlankTrade(supabase, userData.user.id, positionSize);
  void logEvent(supabase, userData.user.id, SERVER_SESSION_ID, "trade_created", { tradeId: trade.id });

  return NextResponse.json(trade, { status: 201 });
}
