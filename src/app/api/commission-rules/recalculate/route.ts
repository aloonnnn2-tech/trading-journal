import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { listCommissionRules } from "@/lib/commissions/queries";
import { resolveCommission } from "@/lib/commissions/calculate";
import { computeDerivedFields } from "@/lib/trades/compute";
import type { Trade, TradeCoreFields } from "@/lib/trades/types";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";

// How many row updates to have in flight at once. Each is its own PATCH
// against PostgREST (a single bulk upsert would risk nulling columns absent
// from the payload), so this bounds the burst without serialising the whole
// backfill.
const CONCURRENCY = 20;

/**
 * Retroactively re-prices every trade against the current commission rules
 * and rewrites its P&L. Deliberately manual rather than automatic: applying
 * new rules to closed history silently restates the dashboard, win rate, and
 * account balance, which should be a decision the user makes on purpose.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = await listCommissionRules(supabase);

  // fetchAllRows: a bulk re-price that silently stops at the 1,000-row page
  // cap would leave old and new commission logic mixed in one dataset.
  let trades: Trade[];
  try {
    // The narrow column list means the client infers a shape narrower than
    // Trade -- fetch untyped and cast once, same as the other call sites.
    trades = (await fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase
        .from("trades")
        .select(
          "id, mode, asset_type, market, status, direction, entry_price, exit_price, stop_loss, take_profit, shares, risk_amount, commission, commission_manual",
        )
        .eq("mode", "trade")
        .order("id", { ascending: true })
        .range(from, to),
    )) as unknown as Trade[];
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "PGRST205" || code === "42P01" || code === "42703") {
      return NextResponse.json(
        { error: "Commissions aren't set up yet — migration 0022 still needs to be run." },
        { status: 503 },
      );
    }
    throw error;
  }
  let updated = 0;
  let skipped = 0;
  const failures: string[] = [];

  const pending = trades.filter((trade) => {
    // A hand-entered commission is the user's own number for that fill --
    // a bulk re-price must never overwrite it.
    if (trade.commission_manual) {
      skipped += 1;
      return false;
    }
    return true;
  });

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (trade) => {
        const commission = resolveCommission(rules, {
          mode: trade.mode,
          asset_type: trade.asset_type,
          market: trade.market,
          status: trade.status,
          direction: trade.direction,
          entry_price: trade.entry_price,
          exit_price: trade.exit_price,
          shares: trade.shares,
        });

        const derived = computeDerivedFields({
          ...(trade as unknown as TradeCoreFields),
          commission,
        });

        const { error: updateError } = await supabase
          .from("trades")
          .update({ commission, ...derived })
          .eq("id", trade.id);

        return updateError ? updateError.message : null;
      }),
    );

    for (const message of results) {
      if (message) failures.push(message);
      else updated += 1;
    }
  }

  void logEvent(supabase, userData.user.id, SERVER_SESSION_ID, "commissions_recalculated", {
    updated,
    skipped,
    failed: failures.length,
  });

  return NextResponse.json({
    updated,
    skipped,
    failed: failures.length,
    // Surfacing one representative message is enough for the user to act on;
    // the full list would just be the same DB error repeated N times.
    error: failures[0] ?? null,
  });
}
