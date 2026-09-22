import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getAnalyticsSummary, type AnalyticsRange, type AnalyticsSummary } from "@/lib/analytics/queries";
import { listStrategies } from "@/lib/strategies/queries";
import type { Strategy } from "@/lib/strategies/types";
import { listRulesForStrategies } from "@/lib/plan-rules/queries";
import type { StrategyRule } from "@/lib/plan-rules/types";
import { listFieldDefinitions, listAllStrategyFieldDefinitions } from "@/lib/fields/definitions";
import type { FieldDefinition } from "@/lib/fields/types";
import { listFolders, listAllTradeFolderLinks } from "@/lib/folders/queries";
import type { Folder } from "@/lib/folders/types";
import { ROW_COLUMNS, type Row } from "./filter";

/**
 * Per-request memo for everything the tools read repeatedly.
 *
 * Before this, every tool call re-fetched the ENTIRE journal (`select *`,
 * every note included) -- up to three times per request -- and the overview's
 * analytics summary was computed and thrown away before the first tool ran.
 * The store memoises the *promise*, so tools running in parallel in one round
 * share a single fetch, and the overview's summary is the same object a
 * `compute_stats` in that request receives.
 *
 * Lifetime is one turn request, on purpose. Not across turns: an applied
 * proposal (Phase 3) changes the journal between turns, and warm serverless
 * instances don't share memory anyway. A `TradeStore` is created by the route
 * and handed to `makeToolExecutor`; nothing here is module-level.
 */
export class TradeStore {
  private tradesP?: Promise<Row[]>;
  private strategiesP?: Promise<Strategy[]>;
  private rulesP?: Promise<Record<string, StrategyRule[]>>;
  private fieldsP?: Promise<{ trade: FieldDefinition[]; investment: FieldDefinition[]; byStrategy: Record<string, FieldDefinition[]> }>;
  private foldersP?: Promise<{ folders: Folder[]; links: Record<string, string[]> }>;
  private summaries = new Map<string, Promise<AnalyticsSummary>>();

  constructor(
    private readonly supabase: SupabaseClient,
    readonly timezone: string | null,
  ) {}

  /** Every trade, newest first, with an explicit column list -- never `*`. */
  trades(): Promise<Row[]> {
    this.tradesP ??= fetchAllRows<Row>((from, to) =>
      this.supabase
        .from("trades")
        .select(ROW_COLUMNS)
        .order("entry_date", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .range(from, to),
    );
    return this.tradesP;
  }

  strategies(): Promise<Strategy[]> {
    this.strategiesP ??= listStrategies(this.supabase);
    return this.strategiesP;
  }

  /** Rules grouped by strategy id, for every strategy the user has. */
  rulesByStrategy(): Promise<Record<string, StrategyRule[]>> {
    this.rulesP ??= this.strategies().then((ss) =>
      ss.length ? listRulesForStrategies(this.supabase, ss.map((s) => s.id)) : {},
    );
    return this.rulesP;
  }

  fields(): Promise<{ trade: FieldDefinition[]; investment: FieldDefinition[]; byStrategy: Record<string, FieldDefinition[]> }> {
    // Strategy-scoped fields exist for both entity types; a strategy's map
    // holds both so an investment tagged with a strategy renders its fields
    // under their labels too.
    this.fieldsP ??= Promise.all([
      listFieldDefinitions(this.supabase, "trade"),
      listFieldDefinitions(this.supabase, "investment"),
      listAllStrategyFieldDefinitions(this.supabase, "trade"),
      listAllStrategyFieldDefinitions(this.supabase, "investment"),
    ]).then(([trade, investment, tradeByStrategy, investmentByStrategy]) => {
      const byStrategy: Record<string, FieldDefinition[]> = { ...tradeByStrategy };
      for (const [sid, defs] of Object.entries(investmentByStrategy)) {
        byStrategy[sid] = [...(byStrategy[sid] ?? []), ...defs];
      }
      return { trade, investment, byStrategy };
    });
    return this.fieldsP;
  }

  folders(): Promise<{ folders: Folder[]; links: Record<string, string[]> }> {
    this.foldersP ??= Promise.all([listFolders(this.supabase), listAllTradeFolderLinks(this.supabase)]).then(
      ([folders, links]) => ({ folders, links }),
    );
    return this.foldersP;
  }

  /** Keyed by range so an all-time summary and a period summary coexist. */
  summary(range?: AnalyticsRange): Promise<AnalyticsSummary> {
    const key = range ? `${range.startIso}|${range.endIso}` : "all";
    let p = this.summaries.get(key);
    if (!p) {
      p = getAnalyticsSummary(this.supabase, this.timezone, range);
      this.summaries.set(key, p);
    }
    return p;
  }
}
