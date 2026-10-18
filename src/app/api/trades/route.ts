import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { createBlankTrade, deleteTrade, updateTrade } from "@/lib/trades/queries";
import { coreFieldsSchema } from "@/lib/trades/schema";
import { pickEditableCore } from "@/lib/trades/pick-core";
import { getAccountBalance } from "@/lib/account/queries";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { enforceTradeCreateLimits } from "@/lib/trades/create-limits";
import { rowLimitResponse } from "@/lib/limits";
import { withIdempotency } from "@/lib/http/idempotency";
import { log } from "@/lib/observability/log";

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Per-minute and hourly: src/lib/trades/create-limits.ts.
  const limited = await enforceTradeCreateLimits(userId);
  if (limited) return limited;

  // Optional body: { core } -- the details Quick trade and the screenshot
  // importer collected. Saved here, in the same request, rather than by a
  // second PATCH from the page that could fail and leave a blank trade.
  let core: ReturnType<typeof pickEditableCore> = {};
  const text = await request.text();
  if (text.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = coreFieldsSchema.safeParse(pickEditableCore((body as { core?: unknown } | null)?.core));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    core = parsed.data;
  }

  // A repeat of the same click (Idempotency-Key) gets the first answer
  // instead of a second trade. See src/lib/http/idempotency.ts.
  return withIdempotency(request, userId, "trades.create", async () => {
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

    let trade;
    try {
      trade = await createBlankTrade(supabase, userId, positionSize);
    } catch (err) {
      // 0067's cap on trades per account: say so instead of a bare 500.
      const limited = rowLimitResponse(err);
      if (limited) return limited;
      throw err;
    }
    if (Object.keys(core).length > 0) {
      try {
        trade = await updateTrade(supabase, trade.id, { core });
      } catch (err) {
        // All or nothing: a trade whose details didn't save is removed, so
        // a retry doesn't leave a blank one behind.
        log.error("trades.create_with_details_failed", { error: err });
        await deleteTrade(supabase, trade.id).catch(() => {});
        return NextResponse.json(
          { error: "Couldn't save the trade's details. Nothing was created; try again." },
          { status: 400 },
        );
      }
    }
    void logEvent(userId, SERVER_SESSION_ID, "trade_created", { tradeId: trade.id });

    return NextResponse.json(trade, { status: 201 });
  });
}
