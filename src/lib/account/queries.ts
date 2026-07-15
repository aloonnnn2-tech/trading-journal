import type { SupabaseClient } from "@supabase/supabase-js";

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
  /** Capital currently tied up in open positions (see costOf below). */
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

// Balance is always derived, never stored: manual adjustments come from the
// account_transactions ledger, and every trade win/loss flows in through
// trades.dollar_pl (recomputed server-side on each trade update), so the
// cash figure tracks trade results automatically -- including when a trade
// is edited or deleted later. committedCash/availableCash are derived the
// same way from currently-open trades, so they never go stale either.
export async function getAccountBalance(supabase: SupabaseClient): Promise<AccountBalance> {
  const [txResult, tradesResult] = await Promise.all([
    supabase.from("account_transactions").select("amount"),
    supabase.from("trades").select("status, dollar_pl, entry_price, shares, position_size"),
  ]);

  if (txResult.error && isMissingTable(txResult.error)) {
    return {
      deposited: 0,
      tradePL: 0,
      balance: 0,
      committedCash: 0,
      availableCash: 0,
      hasTransactions: false,
    };
  }
  if (txResult.error) throw txResult.error;
  if (tradesResult.error) throw tradesResult.error;

  const txRows = txResult.data as { amount: number }[];
  const deposited = txRows.reduce((sum, row) => sum + Number(row.amount), 0);

  const tradeRows = tradesResult.data as {
    status: string;
    dollar_pl: number | null;
    entry_price: number | null;
    shares: number | null;
    position_size: number | null;
  }[];
  let tradePL = 0;
  let committedCash = 0;
  for (const row of tradeRows) {
    if (row.dollar_pl != null) tradePL += Number(row.dollar_pl);
    if (row.status === "open") committedCash += costOf(row);
  }

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
