import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export interface AccountTransaction {
  id: string;
  user_id: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface AccountBalance {
  /** Net of all manual deposits/withdrawals. */
  deposited: number;
  /** Realized P/L summed across every trade that has a computed dollar_pl. */
  tradePL: number;
  /** deposited + tradePL — the cash currently in the account. */
  balance: number;
  /** Capital tied up in open positions plus reserved for pending orders (see
   *  costOf/investmentCostOf below) -- trade-mode positions by
   *  position_size/entry_price*shares, investment-mode positions by
   *  average_cost*total_shares. Pending orders already have a position_size
   *  set aside for them (see scripts/seed-fake-data.mjs), so they reserve
   *  cash the same as an open position, not just once filled. */
  committedCash: number;
  /** balance - committedCash — what's actually free to put into a new trade. */
  availableCash: number;
  /** False until the user records their first deposit; the feature stays
   *  dormant (no position-size prefill) before that. */
  hasTransactions: boolean;
}

// Error codes for "table doesn't exist": PGRST205 is what Supabase's
// PostgREST actually returns when the table is absent from its schema cache
// (verified against this project's live instance); 42P01 is raw Postgres's
// undefined_table, kept as a belt-and-suspenders match. If the app deploys
// before migration 0016 has been run against Supabase, the ledger table is
// missing -- treat that as "no transactions yet" so the dashboard and trade
// creation keep working instead of 500ing.
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
const isMissingTable = (error: { code?: string }) =>
  MISSING_TABLE_CODES.has(error.code ?? "");

// What an open position "costs" -- prefers position_size (the number the
// user explicitly allocated to the trade) since it's the field this app's
// position-size autofill writes to; falls back to entry_price * shares
// (same basis dollar_pl is computed from) when position_size was never set,
// e.g. for trades logged before this field existed or via CSV import.
function costOf(trade: { position_size: number | null; entry_price: number | null; shares: number | null }): number {
  if (trade.position_size != null) return Number(trade.position_size);
  if (trade.entry_price != null && trade.shares != null) {
    return Number(trade.entry_price) * Number(trade.shares);
  }
  return 0;
}

// Investment-mode equivalent of costOf() -- investment trades don't have
// entry_price/shares/position_size (that whole card is hidden in
// TradeCard.tsx for isInvestment), so an open position's cost basis lives
// instead in the seeded default custom fields "Average Cost"
// (average_cost) and "Total Shares" (total_shares), per
// supabase/migrations/0002_seed_default_fields.sql. Falls back to 0 (same
// as costOf) if either has been cleared, renamed away from, or was never
// filled in -- silently under-counting is consistent with how costOf
// already treats an incomplete trade-mode position.
function investmentCostOf(customFields: Record<string, unknown> | null): number {
  const avgCost = Number(customFields?.average_cost);
  const totalShares = Number(customFields?.total_shares);
  if (Number.isFinite(avgCost) && Number.isFinite(totalShares)) return avgCost * totalShares;
  return 0;
}

// Balance is always derived, never stored: manual adjustments come from the
// account_transactions ledger, and every trade win/loss flows in through
// trades.dollar_pl (recomputed server-side on each trade update), so the
// cash figure tracks trade results automatically -- including when a trade
// is edited or deleted later. committedCash/availableCash are derived the
// same way from currently-open-or-pending trades, so they never go stale
// either.
// Split into two narrow queries rather than one `select(5 columns)` over
// every trade. This runs on every dashboard view *and* on every trade
// creation (position-size prefill), so it's on a hot path: the P/L sum only
// needs one column and only from rows that have a P/L, and the committed-
// cash sum only needs the three cost columns from open/pending trades
// (typically a handful). The old single query pulled all five columns for
// every trade the user has ever logged, including the thousands of closed
// ones that contribute nothing to committedCash.
export async function getAccountBalance(supabase: SupabaseClient): Promise<AccountBalance> {
  // fetchAllRows on all three: these are sums, and PostgREST's silent
  // 1,000-row page cap would otherwise truncate them past that count --
  // an account balance that quietly stops including older trades' P/L is
  // the single worst number in the app to get wrong, since position-size
  // prefill spends it. The `.order("id")` on each keeps offset pagination
  // deterministic.
  const [txRows, plRows, committedRows] = await Promise.all([
    fetchAllRows<{ amount: number }>((from, to) =>
      supabase.from("account_transactions").select("amount").order("id").range(from, to),
    ).catch((error: { code?: string }) => {
      // Migration 0016 not applied yet: treat as "no transactions", same
      // dormant-feature behavior as before.
      if (isMissingTable(error)) return null;
      throw error;
    }),
    // Realized, not merely computable: dollar_pl only needs an entry price,
    // an exit price, and a share count -- none of which require the trade
    // to actually be closed. Typing a hypothetical exit price to preview a
    // number, without flipping status, made that preview count as cash that
    // had actually landed. Requiring status = closed is what "realized"
    // means here; mirrored in the dashboard_stats RPC (see migration 0025).
    fetchAllRows<{ dollar_pl: number | null }>((from, to) =>
      supabase
        .from("trades")
        .select("dollar_pl")
        .eq("status", "closed")
        .not("dollar_pl", "is", null)
        .order("id")
        .range(from, to),
    ),
    // Open AND pending: a pending limit/stop order already has its
    // position_size set aside for it (see scripts/seed-fake-data.mjs), so
    // it reserves cash the moment it's placed, not just once it triggers
    // into "open". Excluding pending orders here made availableCash --
    // and the new-trade prefill that spends it -- overstate what's
    // actually free by however much was sitting in pending orders.
    fetchAllRows<{
      mode: string;
      entry_price: number | null;
      shares: number | null;
      position_size: number | null;
      custom_fields: Record<string, unknown> | null;
    }>((from, to) =>
      supabase
        .from("trades")
        .select("mode, entry_price, shares, position_size, custom_fields")
        .in("status", ["open", "pending"])
        .order("id")
        .range(from, to),
    ),
  ]);

  if (txRows === null) {
    return {
      deposited: 0,
      tradePL: 0,
      balance: 0,
      committedCash: 0,
      availableCash: 0,
      hasTransactions: false,
    };
  }

  const deposited = txRows.reduce((sum, row) => sum + Number(row.amount), 0);
  const tradePL = plRows.reduce((sum, row) => sum + Number(row.dollar_pl ?? 0), 0);
  const committedCash = committedRows.reduce(
    (sum, row) => sum + (row.mode === "investment" ? investmentCostOf(row.custom_fields) : costOf(row)),
    0,
  );

  const balance = deposited + tradePL;

  return {
    deposited,
    tradePL,
    balance,
    committedCash,
    availableCash: balance - committedCash,
    hasTransactions: txRows.length > 0,
  };
}

export async function listAccountTransactions(
  supabase: SupabaseClient,
  limit = 20,
): Promise<AccountTransaction[]> {
  const { data, error } = await supabase
    .from("account_transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error && isMissingTable(error)) return [];
  if (error) throw error;
  return data as AccountTransaction[];
}

export async function addAccountTransaction(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  note?: string,
): Promise<AccountTransaction> {
  const { data, error } = await supabase
    .from("account_transactions")
    .insert({ user_id: userId, amount, note: note ?? null })
    .select()
    .single();

  if (error) throw error;
  return data as AccountTransaction;
}

// Returns whether a row was actually deleted, mirroring deleteTrade, so the
// route can 404 for ids that don't exist or belong to another user.
export async function deleteAccountTransaction(
  supabase: SupabaseClient,
  id: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("account_transactions")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
