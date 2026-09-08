import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { listAllStrategyFieldDefinitions, listFieldDefinitions } from "@/lib/fields/definitions";
import { listFolders, listTradeFolderIds } from "@/lib/folders/queries";
import { getUserSettings } from "@/lib/settings/queries";
import { getTrade } from "@/lib/trades/queries";
import { listTradeImages } from "@/lib/images/queries";
import { listStrategies, listTradeStrategyIds } from "@/lib/strategies/queries";
import { listCommissionRules } from "@/lib/commissions/queries";
import { getAccountBalance } from "@/lib/account/queries";
import { listApiKeys } from "@/lib/ai-keys/queries";
import { listConsentedProviders } from "@/lib/ai-keys/consent";
import { getTradeReview, isTradeReviewStale } from "@/lib/ai-reviews/queries";
import { isPaidUser } from "@/lib/settings/plan";
import { TradeCard } from "@/components/trade-card/TradeCard";
import { TradeHistoryPanel } from "@/components/trade-card/trade-history-panel";
import { AiReviewPanel } from "@/components/trade-card/ai-review-panel";
import { PlanAdherencePanel } from "@/components/trade-card/plan-adherence-panel";
import { TradeExcursionPanel } from "@/components/trade-card/excursion-panel";
import { TradeTimeline } from "@/components/trade-card/trade-timeline";
import { TagSuggestionsPanel } from "@/components/trade-card/tag-suggestions-panel";
import { buildReplay } from "@/lib/replay/build";
import { getExcursion } from "@/lib/excursions/queries";
import { listRulesForStrategies } from "@/lib/plan-rules/queries";
import { evaluateStrategyRules } from "@/lib/plan-rules/evaluate";
import { detectAdjustments } from "@/lib/trades/adjustments";
import { getTradeSuggestions } from "@/lib/mistakes/trade-suggestions";
import { listTradeHistory } from "@/lib/trades/history";

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await requireUserId();
  const supabase = await createClient();

  const trade = await getTrade(supabase, id);
  if (!trade) notFound();

  const [
    fieldDefinitions,
    settings,
    folders,
    initialFolderIds,
    rawImages,
    strategies,
    initialStrategyIds,
    strategyFieldDefinitions,
    commissionRules,
    account,
    aiReview,
    apiKeys,
    consentedProviders,
  ] = await Promise.all([
    listFieldDefinitions(supabase, trade.mode),
    getUserSettings(supabase, userId),
    listFolders(supabase),
    listTradeFolderIds(supabase, id),
    listTradeImages(supabase, id),
    listStrategies(supabase),
    listTradeStrategyIds(supabase, id),
    listAllStrategyFieldDefinitions(supabase, trade.mode),
    listCommissionRules(supabase),
    getAccountBalance(supabase),
    // The AI review panel's three inputs. Each falls back to "nothing" rather
    // than throwing, because all three read tables added by hand-applied
    // migrations (0029/0031/0032) -- on an environment where one is still
    // pending, the panel must degrade to its empty state instead of taking
    // the whole trade page down with it. The generate route reports a missing
    // migration properly, which is where a user can act on it.
    getTradeReview(supabase, id).catch(() => null),
    listApiKeys(supabase).catch(() => []),
    listConsentedProviders(supabase).catch(() => []),
  ]);

  // This trade's excursion, if it has been measured. RLS-scoped, and it
  // degrades to null before migration 0035 so the panel shows "not measured
  // yet" rather than breaking the page.
  const excursion = await getExcursion(supabase, id).catch(() => null);

  // ---- Plan adherence ----------------------------------------------------
  //
  // Computed here rather than stored: it is a pure function of the trade, its
  // strategies' rules and its edit history, so recomputing on every render is
  // both cheap and the only way it can never be stale. See 0033.
  const rulesByStrategy = await listRulesForStrategies(supabase, initialStrategyIds);

  // Fetched once and shared three ways: the plan-rule engine needs it for
  // "stop was moved", the timeline needs it for every change, and the tag
  // suggestions need it for the same two adjustments. Three reads of the same
  // rows would be two queries too many on a page that already makes a dozen.
  const history = await listTradeHistory(supabase, id).catch(() => []);

  // Computed unconditionally now that the history is always read: it is a pure
  // function over rows already in memory, so there is nothing left to save by
  // deciding in advance whether a rule will ask for it.
  const adjustments = detectAdjustments(
    // listTradeHistory returns newest-first; the detector wants oldest-first.
    [...history].reverse().map((entry) => ({
      stop_loss: entry.snapshot?.stop_loss ?? null,
      take_profit: entry.snapshot?.take_profit ?? null,
    })),
    trade,
  );

  // Tags the app can offer on this trade. Needs the same adjustments, so it
  // sits after them. Degrades to none rather than throwing: it reads the
  // journal for the trader's median risk, and a suggestion strip is not worth
  // taking the trade page down for.
  const suggestions = await getTradeSuggestions(supabase, trade, adjustments).catch(() => []);

  // Same rows, oldest-first, diffed into a readable sequence of events.
  const replay = buildReplay(
    trade,
    [...history].reverse().map((entry) => ({
      createdAt: entry.createdAt,
      snapshot: entry.snapshot,
    })),
  );

  const adherences = initialStrategyIds
    .filter((strategyId) => (rulesByStrategy[strategyId] ?? []).some((rule) => rule.enabled))
    .map((strategyId) =>
      evaluateStrategyRules(
        { trade, strategyId, rules: rulesByStrategy[strategyId] ?? [], adjustments },
        strategies.find((s) => s.id === strategyId)?.name ?? "Strategy",
      ),
    );

  // Generate signed URLs for all images in one batched Storage call (1-hour
  // expiry, server-side only) rather than one round trip per image -- with
  // several screenshots on a trade, N sequential API calls was a real chunk
  // of this page's load time.
  const signedUrls =
    rawImages.length > 0
      ? await supabase.storage
          .from("trade-images")
          .createSignedUrls(rawImages.map((img) => img.storage_path), 3600)
      : { data: [] };
  const urlByPath = new Map(signedUrls.data?.map((r) => [r.path, r.signedUrl]) ?? []);
  const initialImages = rawImages.map((img) => ({
    id: img.id,
    storagePath: img.storage_path,
    signedUrl: urlByPath.get(img.storage_path) ?? "",
  }));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <Link href="/trades" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← Back to Trades
      </Link>
      <TradeCard
        key={`trade-card-${id}`}
        trade={trade}
        fieldDefinitions={fieldDefinitions}
        hiddenCoreFields={settings.hidden_core_fields}
        folders={folders}
        initialFolderIds={initialFolderIds}
        initialImages={initialImages}
        strategies={strategies}
        initialStrategyIds={initialStrategyIds}
        strategyFieldDefinitions={strategyFieldDefinitions}
        commissionRules={commissionRules}
        accountBalance={account.hasTransactions ? account.balance : null}
      />
      {/* Suggestions stay expanded: they are about this trade specifically and
          disappear once dealt with, so they are never permanent clutter.
          The four panels below are reference material. */}
      <TagSuggestionsPanel key={`suggestions-${id}`} tradeId={id} suggestions={suggestions} />

      <section className="flex flex-col gap-2">
        <TradeTimeline key={`timeline-${id}`} replay={replay} />
      </section>

      <section className="flex flex-col gap-2">
        <TradeExcursionPanel
          key={`excursion-${id}`}
          excursion={excursion}
          trade={{
            entry_price: trade.entry_price,
            exit_price: trade.exit_price,
            direction: trade.direction,
          }}
          isPaid={isPaidUser(settings)}
        />
      </section>

      <section className="flex flex-col gap-2">
        <PlanAdherencePanel
          key={`plan-adherence-${id}`}
          adherences={adherences}
          hasStrategies={initialStrategyIds.length > 0}
        />
      </section>

      <AiReviewPanel
        key={`ai-review-${id}`}
        tradeId={id}
        isClosed={trade.status === "closed"}
        isInvestment={trade.mode === "investment"}
        isPaid={isPaidUser(settings)}
        keys={apiKeys}
        initialConsents={consentedProviders}
        initialReview={aiReview}
        initialStale={aiReview ? isTradeReviewStale(aiReview, trade) : false}
      />
      <section className="flex flex-col gap-2">
        <TradeHistoryPanel key={`trade-history-${id}`} tradeId={id} />
      </section>
    </div>
  );
}
