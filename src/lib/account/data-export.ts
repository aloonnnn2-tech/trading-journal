import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { isMissingTableError } from "@/lib/supabase/errors";

/**
 * "Download all my data" (security hardening, Part B): everything this app
 * stores about one account, as one JSON document. The trades-only export
 * (/api/trades/export) is a journal tool; this is the access copy.
 *
 * Every table holding a user's rows is listed here, so a new table is a
 * one-line addition, and data-export.test.ts fails if a migration adds a
 * user-owned table that is missing from this list or EXCLUDED below.
 */

export interface ExportSection {
  /** Key in the output document. */
  name: string;
  /** Reads this user's rows, page by page. */
  rows: (ctx: ExportContext) => Promise<unknown[]>;
}

export interface ExportContext {
  /** The user's own RLS-bound client: can only ever see their rows. */
  db: SupabaseClient;
  /** Service-role client, used ONLY for the analytics tables, which a user
   *  cannot read through RLS (0013), always filtered by `userId`. */
  admin: SupabaseClient | null;
  userId: string;
}

const own =
  (table: string, columns = "*", order = "created_at") =>
  ({ db }: ExportContext) =>
    fetchAllRows((from, to) => db.from(table).select(columns).order(order).range(from, to));

export const EXPORT_SECTIONS: ExportSection[] = [
  { name: "settings", rows: own("user_settings", "*", "user_id") },
  { name: "trades", rows: own("trades") },
  { name: "trade_history", rows: own("trade_history") },
  { name: "trade_excursions", rows: own("trade_excursions", "*", "computed_at") },
  { name: "strategies", rows: own("strategies") },
  { name: "trade_strategies", rows: own("trade_strategies", "*", "trade_id") },
  { name: "strategy_rules", rows: own("strategy_rules") },
  { name: "folders", rows: own("folders") },
  { name: "trade_folders", rows: own("trade_folders", "*", "trade_id") },
  { name: "custom_fields", rows: own("field_definitions") },
  { name: "goals", rows: own("goals") },
  { name: "review_of_trading_lens", rows: own("app_reviews") },
  { name: "cash_entries", rows: own("account_transactions") },
  { name: "monthly_costs", rows: own("monthly_costs") },
  { name: "monthly_cost_postings", rows: own("monthly_cost_postings") },
  { name: "fees", rows: own("commission_rules") },
  { name: "ai_reviews", rows: own("ai_reviews") },
  { name: "ai_conversations", rows: own("ai_conversations") },
  { name: "ai_messages", rows: own("ai_messages") },
  {
    // Changes Ask suggested and what became of them (0070). Read leniently:
    // until that migration is applied the table doesn't exist, and the export
    // must not fail for it.
    name: "ai_suggested_changes",
    rows: (ctx) => own("ai_proposals")(ctx).catch((err: unknown) => {
      if (isMissingTableError(err)) return [];
      throw err;
    }),
  },
  { name: "ai_provider_consents", rows: own("ai_provider_consents", "*", "accepted_at") },
  {
    // Public columns only: the encrypted key is never readable by the user
    // (0058) and is not "their data" in any useful sense -- they hold the key.
    name: "ai_keys",
    rows: own(
      "user_api_keys",
      "id, provider, label, last_four, is_active, model, created_at, updated_at, last_validated_at, last_used_at",
    ),
  },
  {
    // Screenshot files live in Storage; the export lists them with a link
    // that works for an hour rather than inlining megabytes of base64.
    name: "screenshots",
    rows: async (ctx) => {
      const images = (await own("trade_images")(ctx)) as unknown as { storage_path: string }[];
      if (images.length === 0) return [];
      const { data } = await ctx.db.storage.from("trade-images").createSignedUrls(
        images.map((i) => i.storage_path),
        3600,
      );
      const urlByPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
      return images.map((i) => ({ ...i, download_url_valid_1h: urlByPath.get(i.storage_path) ?? null }));
    },
  },
  {
    name: "usage_events",
    rows: async ({ admin, userId }) =>
      admin
        ? fetchAllRows((from, to) =>
            admin
              .from("analytics_events")
              .select("created_at, event_name, event_props, session_id")
              .eq("user_id", userId)
              .order("created_at")
              .range(from, to),
          )
        : [],
  },
  {
    name: "usage_sessions",
    rows: async ({ admin, userId }) =>
      admin
        ? fetchAllRows((from, to) =>
            admin
              .from("analytics_sessions")
              .select("started_at, last_seen_at, duration_seconds")
              .eq("user_id", userId)
              .order("started_at")
              .range(from, to),
          )
        : [],
  },
];

/**
 * Tables deliberately NOT in the export, with the reason. Anything not in
 * EXPORT_SECTIONS must be here, or the drift test fails.
 */
export const EXCLUDED_TABLES: Record<string, string> = {
  rate_limit_counters: "Abuse counters keyed by user id or IP; operational, expire within a day.",
  idempotency_keys: "Copies of the answer to a create request, kept a day so a repeat isn't run twice; operational.",
  schema_migrations: "Not user data.",
  waitlist: "Not linked to an account (anyone can join with any address).",
  public_page_views: "Anonymous daily totals; nothing per person.",
};

/** Tables the sections above read, for the drift test. */
export const EXPORTED_TABLES = [
  "user_settings",
  "trades",
  "trade_history",
  "trade_excursions",
  "strategies",
  "trade_strategies",
  "strategy_rules",
  "folders",
  "trade_folders",
  "field_definitions",
  "goals",
  "app_reviews",
  "account_transactions",
  "monthly_costs",
  "monthly_cost_postings",
  "commission_rules",
  "ai_reviews",
  "ai_conversations",
  "ai_messages",
  "ai_proposals",
  "ai_provider_consents",
  "user_api_keys",
  "trade_images",
  "analytics_events",
  "analytics_sessions",
];
