import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { rateLimit } from "@/lib/rate-limit";
import { enforceDailyCap } from "@/lib/rate-limits/daily";
import { listOverallRules, refreshMarketChecks, type RuleCheckTrade } from "@/lib/overall-rules/queries";
import { log } from "@/lib/observability/log";

// "Check all my trades": works out every missing or stale moving-average
// result. One price request per distinct symbol, through the app-wide Yahoo
// ceiling -- the same shape (and the same reason for the tight limits) as
// the MAE/MFE recalculation. Free: the results are the user's own journal.
// A run checks at most MAX_SYMBOLS symbols; the answer says how many are
// left, and running it again carries on (finished ones are fresh, so they
// cost nothing).

const MAX_SYMBOLS = 30;
export const maxDuration = 26;

export async function POST() {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await rateLimit(`overall-rules-check:${userId}`, 3, 5 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Your trades were just checked. Give it a few minutes before running it again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const daily = await enforceDailyCap("rule-checks", userId);
  if (daily) return daily;

  const supabase = await createClient();
  const rules = await listOverallRules(supabase);
  if (rules === null) {
    return NextResponse.json(
      { error: "Overall rules aren't switched on yet (migration 0081 still needs to be run)." },
      { status: 503 },
    );
  }

  const trades = await fetchAllRows<RuleCheckTrade>((from, to) =>
    supabase
      .from("trades")
      .select("*")
      .in("status", ["open", "closed"])
      .neq("mode", "investment")
      .order("entry_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to),
  );

  try {
    const { summary } = await refreshMarketChecks(supabase, userId, trades, rules, { maxSymbols: MAX_SYMBOLS });
    return NextResponse.json(summary);
  } catch (err) {
    log.error("overall_rules.check_failed", { error: err });
    return NextResponse.json({ error: "Couldn't check your trades. Try again in a moment." }, { status: 500 });
  }
}
