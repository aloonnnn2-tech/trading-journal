import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { createBlankTrade } from "@/lib/trades/queries";
import { getAccountBalance } from "@/lib/account/queries";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST() {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Creating a trade is a button press, so 60/min is far above any real use
  // while stopping a loop from filling an account with blank rows.
  const limited = enforceRateLimit(
    `trades-create:${userId}`,
    60,
    60_000,
    "You're creating trades faster than we can keep up. Wait a moment and try again.",
  );
  if (limited) return limited;

  const supabase = await createClient();

  // Position size auto-fills from the cash actually free to trade with --
  // total balance minus whatever's already committed to open positions --
  // so it never suggests sizing a new trade with money that's tied up
  // elsewhere. It's an ordinary editable field, so this is just a starting
  // point.
  const account = await getAccountBalance(supabase);
  const positionSize =
    account.hasTransactions && account.availableCash > 0
      ? Math.round(account.availableCash * 100) / 100
      : null;

  const trade = await createBlankTrade(supabase, userId, positionSize);
  void logEvent(supabase, userId, SERVER_SESSION_ID, "trade_created", { tradeId: trade.id });

  return NextResponse.json(trade, { status: 201 });
}
