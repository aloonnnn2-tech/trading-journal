import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getTrade } from "@/lib/trades/queries";
import { listTradeHistory } from "@/lib/trades/history";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { listTradeImages } from "@/lib/images/queries";
import { listStrategies, listTradeStrategyIds } from "@/lib/strategies/queries";
import { listRulesForStrategies } from "@/lib/plan-rules/queries";
import { planAdherenceFor } from "@/lib/plan-rules/trade-adherence";
import { isTradeId, panelTextFields, type TradePanelData } from "@/lib/trades/panel";

// The trade side panel's data (Phase 4A). Read-only: everything here is also
// on /trades/[id], loaded the same way, and plan adherence comes from the
// same helper so the two can't disagree.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Each arrow press fetches one trade and prefetches its two neighbours, so
  // a quick run through a page of trades is a few dozen requests. The same
  // ceiling as autosave: generous for a person, a cap for a runaway client.
  const limited = await enforceRateLimit(
    `trade-panel:${userId}`,
    240,
    60_000,
    "Too many requests in a row. Wait a moment and try again.",
  );
  if (limited) return limited;

  if (!isTradeId(id)) {
    return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const trade = await getTrade(supabase, id);
  // RLS already hides other people's trades; the owner check is the second
  // lock, so a policy mistake can't turn this into a read of someone else's.
  if (!trade || trade.user_id !== userId) {
    return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  }

  const [strategyIds, strategies, rawImages, definitions, history] = await Promise.all([
    listTradeStrategyIds(supabase, id),
    listStrategies(supabase),
    listTradeImages(supabase, id),
    listFieldDefinitions(supabase, trade.mode),
    // Degrades to none, as on the trade page: without history, stop/target
    // rules read as "can't be checked" rather than breaking the panel.
    listTradeHistory(supabase, id).catch(() => []),
  ]);

  const rulesByStrategy = await listRulesForStrategies(supabase, strategyIds);
  const { adherences } = planAdherenceFor({ trade, strategyIds, strategies, rulesByStrategy, history });

  // One batched call for every screenshot, as on the trade page.
  const signed =
    rawImages.length > 0
      ? await supabase.storage.from("trade-images").createSignedUrls(
          rawImages.map((img) => img.storage_path),
          3600,
        )
      : { data: [] };
  const urlByPath = new Map(signed.data?.map((r) => [r.path, r.signedUrl]) ?? []);

  const nameById = new Map(strategies.map((s) => [s.id, s.name]));
  const body: TradePanelData = {
    trade,
    strategyNames: strategyIds.map((sid) => nameById.get(sid)).filter((n): n is string => Boolean(n)),
    hasStrategies: strategyIds.length > 0,
    adherences,
    images: rawImages
      .map((img) => ({ id: img.id, url: urlByPath.get(img.storage_path) ?? "" }))
      .filter((img) => img.url),
    textFields: panelTextFields(definitions, trade.custom_fields ?? {}),
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
