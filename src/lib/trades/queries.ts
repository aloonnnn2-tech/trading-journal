import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDerivedFields } from "./compute";
import type { EditableCoreField, Trade, TradeCoreFields } from "./types";

export async function listTrades(supabase: SupabaseClient): Promise<Trade[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Trade[];
}

export async function getTrade(supabase: SupabaseClient, id: string): Promise<Trade | null> {
  const { data, error } = await supabase.from("trades").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Trade | null;
}

export async function createBlankTrade(
  supabase: SupabaseClient,
  userId: string,
): Promise<Trade> {
  const { data, error } = await supabase
    .from("trades")
    .insert({
      user_id: userId,
      mode: "trade",
      ticker: "",
      status: "pending",
      result: "open",
      custom_fields: {},
    })
    .select()
    .single();

  if (error) throw error;
  return data as Trade;
}

// Merges core column changes + custom_fields changes, recomputes the
// derived P/L columns from the resulting row, and writes everything in
// one update. Caller is responsible for validating customFields against
// buildCustomFieldsSchema(...) before calling this.
export async function updateTrade(
  supabase: SupabaseClient,
  id: string,
  changes: {
    core?: Partial<Record<EditableCoreField, unknown>>;
    customFields?: Record<string, unknown>;
  },
): Promise<Trade> {
  const existing = await getTrade(supabase, id);
  if (!existing) throw new Error("Trade not found");

  const mergedCore = { ...existing, ...changes.core };
  const mergedCustomFields = changes.customFields
    ? { ...existing.custom_fields, ...changes.customFields }
    : existing.custom_fields;

  const derived = computeDerivedFields(mergedCore as unknown as TradeCoreFields);

  const { data, error } = await supabase
    .from("trades")
    .update({
      ...(changes.core ?? {}),
      custom_fields: mergedCustomFields,
      ...derived,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Trade;
}

// Returns whether a row was actually deleted, so the route can 404 rather
// than report success for an id that didn't exist (or belonged to another
// user and was silently filtered out by RLS).
export async function deleteTrade(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("trades").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function duplicateTrade(supabase: SupabaseClient, id: string): Promise<Trade> {
  const existing = await getTrade(supabase, id);
  if (!existing) throw new Error("Trade not found");

  const {
    id: _id,
    created_at: _createdAt,
    updated_at: _updatedAt,
    ...rest
  } = existing;

  const { data, error } = await supabase
    .from("trades")
    .insert({
      ...rest,
      status: "pending",
      result: "open",
    })
    .select()
    .single();

  if (error) throw error;
  return data as Trade;
}

export type TradeSortField = "created_at" | "entry_date" | "exit_date" | "ticker" | "dollar_pl";

export interface TradeListFilters {
  search?: string;
  status?: Trade["status"];
  folderId?: string;
  tag?: string;
  market?: string;
  plMin?: number;
  plMax?: number;
  emotion?: string;
  customField?: { key: string; value: string };
  sortBy?: TradeSortField;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const EMOTION_FIELD_KEYS = ["emotion_before", "emotion_during", "emotion_after"];

// PostgREST's `.or()` syntax splits its argument on commas between
// conditions, so a value containing a comma (an emotion tag can be any
// free text the user typed on the Emotions page) needs to be wrapped in
// double quotes -- with any embedded double quotes escaped -- to be safely
// treated as one literal token. Backslashes must be escaped first: the
// value here is already a JSON.stringify() result, which backslash-escapes
// its own embedded quotes, and escaping quotes before backslashes would
// double-escape those, corrupting the token.
function quoteOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const STRATEGY_TAG_KEY = "strategy_setup";

// Server-side filtered/sorted/paginated trade list -- the query that
// scales to 100k+ trades. Ticker/company search relies on the pg_trgm
// GIN indexes (migration 0005); status filtering relies on the
// (user_id, status) btree index from migration 0001; folder filtering
// uses an inner join against trade_folders rather than fetching every
// trade and filtering in JS.
export async function listTradesPage(
  supabase: SupabaseClient,
  filters: TradeListFilters,
): Promise<{ trades: Trade[]; total: number }> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const sortBy = filters.sortBy ?? "created_at";
  const sortDir = filters.sortDir ?? "desc";

  let query = supabase
    .from("trades")
    .select(filters.folderId ? "*, trade_folders!inner(folder_id)" : "*", { count: "exact" });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.folderId) query = query.eq("trade_folders.folder_id", filters.folderId);
  if (filters.tag) query = query.contains("custom_fields", { [STRATEGY_TAG_KEY]: [filters.tag] });
  if (filters.search) {
    const term = filters.search.replace(/[%,]/g, "");
    query = query.or(`ticker.ilike.%${term}%,company_name.ilike.%${term}%`);
  }
  if (filters.market) query = query.eq("market", filters.market);
  if (filters.plMin != null) query = query.gte("dollar_pl", filters.plMin);
  if (filters.plMax != null) query = query.lte("dollar_pl", filters.plMax);
  if (filters.emotion) {
    // Emotion fields are stored as tag-type custom fields (string arrays),
    // one per before/during/after slot -- a trade matches if any slot
    // contains the requested emotion.
    const value = quoteOrValue(JSON.stringify([filters.emotion]));
    query = query.or(
      EMOTION_FIELD_KEYS.map((key) => `custom_fields->${key}.cs.${value}`).join(","),
    );
  }
  if (filters.customField) {
    query = query.contains("custom_fields", { [filters.customField.key]: filters.customField.value });
  }

  query = query
    .order(sortBy, { ascending: sortDir === "asc", nullsFirst: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return { trades: data as unknown as Trade[], total: count ?? 0 };
}

export async function getStatusCounts(
  supabase: SupabaseClient,
): Promise<{ all: number; pending: number; open: number; closed: number }> {
  const base = () => supabase.from("trades").select("*", { count: "exact", head: true });

  const [all, pending, open, closed] = await Promise.all([
    base(),
    base().eq("status", "pending"),
    base().eq("status", "open"),
    base().eq("status", "closed"),
  ]);

  return {
    all: all.count ?? 0,
    pending: pending.count ?? 0,
    open: open.count ?? 0,
    closed: closed.count ?? 0,
  };
}

// Distinct strategy/setup tag values across all of the user's trades, for
// populating the tag filter dropdown. Pulls just the one jsonb key rather
// than full rows -- cheap even with many trades.
export async function listDistinctStrategyTags(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("trades").select("custom_fields");
  if (error) throw error;

  const tags = new Set<string>();
  for (const row of data as { custom_fields: Record<string, unknown> }[]) {
    const value = row.custom_fields?.[STRATEGY_TAG_KEY];
    if (Array.isArray(value)) {
      for (const tag of value) {
        if (typeof tag === "string" && tag.trim() !== "") tags.add(tag);
      }
    }
  }
  return Array.from(tags).sort();
}

// Distinct values seen across the three emotion slots, for populating the
// emotion filter dropdown -- same shape as listDistinctStrategyTags.
export async function listDistinctEmotions(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("trades").select("custom_fields");
  if (error) throw error;

  const emotions = new Set<string>();
  for (const row of data as { custom_fields: Record<string, unknown> }[]) {
    for (const key of EMOTION_FIELD_KEYS) {
      const value = row.custom_fields?.[key];
      if (Array.isArray(value)) {
        for (const emotion of value) {
          if (typeof emotion === "string" && emotion.trim() !== "") emotions.add(emotion);
        }
      }
    }
  }
  return Array.from(emotions).sort();
}

export async function listDistinctMarkets(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("market")
    .not("market", "is", null);
  if (error) throw error;

  const markets = new Set<string>();
  for (const row of data as { market: string | null }[]) {
    if (row.market) markets.add(row.market);
  }
  return Array.from(markets).sort();
}

export function getStrategyTags(trade: Trade): string[] {
  const value = trade.custom_fields?.[STRATEGY_TAG_KEY];
  return Array.isArray(value) ? (value.filter((v) => typeof v === "string") as string[]) : [];
}
