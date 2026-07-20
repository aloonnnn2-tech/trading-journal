import type { SupabaseClient } from "@supabase/supabase-js";

export interface EquityPoint {
  date: string;
  dollar_pl: number;
  equity: number;
  drawdown: number;
}

export interface RMultipleBucket {
  label: string;
  count: number;
}

export interface DirectionBreakdown {
  direction: string;
  trades: number;
  wins: number;
  winRate: number | null;
  totalPL: number;
}

export interface TagBreakdown {
  tag: string;
  trades: number;
  wins: number;
  winRate: number | null;
  totalPL: number;
}

export interface MonthlyPL {
  month: string; // YYYY-MM
  totalPL: number;
}

export interface AnalyticsSummary {
  totalPL: number;
  closedCount: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  maxDrawdown: number;
  equityCurve: EquityPoint[];
  rMultiples: RMultipleBucket[];
  byDirection: DirectionBreakdown[];
  byTag: TagBreakdown[];
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: { type: "win" | "loss" | null; count: number };
  byMonth: MonthlyPL[];
  bestMonth: MonthlyPL | null;
  worstMonth: MonthlyPL | null;
  avgHoldingDays: number | null;
  largestWinner: number | null;
  largestLoser: number | null;
  avgPositionSize: number | null;
}

const R_BUCKET_EDGES = [-3, -2, -1, 0, 1, 2, 3];

function bucketLabel(r: number): string {
  for (let i = 0; i < R_BUCKET_EDGES.length - 1; i++) {
    const lo = R_BUCKET_EDGES[i];
    const hi = R_BUCKET_EDGES[i + 1];
    if (r >= lo && r < hi) return `${lo} to ${hi}`;
  }
  return r < R_BUCKET_EDGES[0] ? `< ${R_BUCKET_EDGES[0]}` : `> ${R_BUCKET_EDGES[R_BUCKET_EDGES.length - 1]}`;
}

// Single pass over every closed trade -- cheap enough at the scale this
// app targets (a user's own trade history, not multi-tenant aggregates)
// and keeps the equity curve, drawdown, and R-distribution consistent
// with each other since they all derive from the same fetched rows.
export async function getAnalyticsSummary(supabase: SupabaseClient): Promise<AnalyticsSummary> {
  const { data, error } = await supabase
    .from("trades")
    .select(
      "entry_date, exit_date, dollar_pl, r_multiple, direction, result, position_size, trade_strategies(strategies(name))",
    )
    .eq("status", "closed")
    .not("exit_date", "is", null)
    .order("exit_date", { ascending: true });

  if (error) throw error;

  const rows = data as {
    entry_date: string | null;
    exit_date: string;
    dollar_pl: number | null;
    r_multiple: number | null;
    direction: string | null;
    result: string;
    position_size: number | null;
    // Supabase's untyped client always types a nested embed as an array
    // regardless of the FK's actual to-one cardinality.
    trade_strategies: { strategies: { name: string }[] }[];
  }[];

  let totalPL = 0;
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let rSum = 0;
  let rCount = 0;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve: EquityPoint[] = [];

  const rBuckets = new Map<string, number>();
  const byDirectionMap = new Map<string, { trades: number; wins: number; totalPL: number }>();
  const byTagMap = new Map<string, { trades: number; wins: number; totalPL: number }>();
  const byMonthMap = new Map<string, number>();

  let currentStreakType: "win" | "loss" | null = null;
  let currentStreakCount = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;

  let holdingDaysSum = 0;
  let holdingDaysCount = 0;
  let largestWinner: number | null = null;
  let largestLoser: number | null = null;
  let positionSizeSum = 0;
  let positionSizeCount = 0;

  for (const row of rows) {
    const pl = row.dollar_pl ?? 0;
    totalPL += pl;
    if (pl > 0) {
      wins += 1;
      grossWin += pl;
      largestWinner = largestWinner === null ? pl : Math.max(largestWinner, pl);
    } else if (pl < 0) {
      losses += 1;
      grossLoss += Math.abs(pl);
      largestLoser = largestLoser === null ? pl : Math.min(largestLoser, pl);
    }

    // Streaks only count decisive wins/losses -- a break-even trade
    // neither extends nor resets the current streak.
    if (pl > 0 || pl < 0) {
      const type = pl > 0 ? "win" : "loss";
      currentStreakCount = currentStreakType === type ? currentStreakCount + 1 : 1;
      currentStreakType = type;
      if (type === "win") longestWinStreak = Math.max(longestWinStreak, currentStreakCount);
      else longestLossStreak = Math.max(longestLossStreak, currentStreakCount);
    }

    if (row.entry_date) {
      const days = (new Date(row.exit_date).getTime() - new Date(row.entry_date).getTime()) / 86_400_000;
      if (days >= 0) {
        holdingDaysSum += days;
        holdingDaysCount += 1;
      }
    }

    if (row.position_size != null) {
      positionSizeSum += row.position_size;
      positionSizeCount += 1;
    }

    const month = row.exit_date.slice(0, 7);
    byMonthMap.set(month, (byMonthMap.get(month) ?? 0) + pl);

    if (row.r_multiple != null) {
      rSum += row.r_multiple;
      rCount += 1;
      const label = bucketLabel(row.r_multiple);
      rBuckets.set(label, (rBuckets.get(label) ?? 0) + 1);
    }

    equity += pl;
    peak = Math.max(peak, equity);
    const drawdown = equity - peak;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    equityCurve.push({ date: row.exit_date, dollar_pl: pl, equity, drawdown });

    const direction = row.direction ?? "unknown";
    const bucket = byDirectionMap.get(direction) ?? { trades: 0, wins: 0, totalPL: 0 };
    bucket.trades += 1;
    if (pl > 0) bucket.wins += 1;
    bucket.totalPL += pl;
    byDirectionMap.set(direction, bucket);

    // A trade can use multiple strategies at once, so it's attributed to
    // every strategy bucket it has rather than just one -- unlike
    // direction, this isn't a partition of trades.
    const tags = row.trade_strategies
      .flatMap((link) => link.strategies)
      .map((s) => s?.name)
      .filter((name): name is string => typeof name === "string" && name.trim() !== "");
    for (const tag of tags.length > 0 ? tags : ["Untagged"]) {
      const tagBucket = byTagMap.get(tag) ?? { trades: 0, wins: 0, totalPL: 0 };
      tagBucket.trades += 1;
      if (pl > 0) tagBucket.wins += 1;
      tagBucket.totalPL += pl;
      byTagMap.set(tag, tagBucket);
    }
  }

  const closedCount = rows.length;
  const byDirection: DirectionBreakdown[] = Array.from(byDirectionMap.entries()).map(
    ([direction, stats]) => ({
      direction,
      trades: stats.trades,
      wins: stats.wins,
      winRate: stats.trades > 0 ? stats.wins / stats.trades : null,
      totalPL: stats.totalPL,
    }),
  );

  const byTag: TagBreakdown[] = Array.from(byTagMap.entries())
    .map(([tag, stats]) => ({
      tag,
      trades: stats.trades,
      wins: stats.wins,
      winRate: stats.trades > 0 ? stats.wins / stats.trades : null,
      totalPL: stats.totalPL,
    }))
    .sort((a, b) => b.trades - a.trades);

  const rMultiples: RMultipleBucket[] = R_BUCKET_EDGES.slice(0, -1)
    .map((lo, i) => `${lo} to ${R_BUCKET_EDGES[i + 1]}`)
    .map((label) => ({ label, count: rBuckets.get(label) ?? 0 }));
  const belowMin = rBuckets.get(`< ${R_BUCKET_EDGES[0]}`);
  const aboveMax = rBuckets.get(`> ${R_BUCKET_EDGES[R_BUCKET_EDGES.length - 1]}`);
  if (belowMin) rMultiples.unshift({ label: `< ${R_BUCKET_EDGES[0]}`, count: belowMin });
  if (aboveMax) rMultiples.push({ label: `> ${R_BUCKET_EDGES[R_BUCKET_EDGES.length - 1]}`, count: aboveMax });

  const byMonth: MonthlyPL[] = Array.from(byMonthMap.entries())
    .map(([month, total]) => ({ month, totalPL: total }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const bestMonth = byMonth.length > 0 ? byMonth.reduce((a, b) => (b.totalPL > a.totalPL ? b : a)) : null;
  const worstMonth = byMonth.length > 0 ? byMonth.reduce((a, b) => (b.totalPL < a.totalPL ? b : a)) : null;

  return {
    totalPL,
    closedCount,
    winRate: closedCount > 0 ? wins / closedCount : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy: rCount > 0 ? rSum / rCount : null,
    avgWin: wins > 0 ? grossWin / wins : null,
    avgLoss: losses > 0 ? grossLoss / losses : null,
    maxDrawdown,
    equityCurve,
    rMultiples,
    byDirection,
    byTag,
    longestWinStreak,
    longestLossStreak,
    currentStreak: { type: currentStreakType, count: currentStreakCount },
    byMonth,
    bestMonth,
    worstMonth,
    avgHoldingDays: holdingDaysCount > 0 ? holdingDaysSum / holdingDaysCount : null,
    largestWinner,
    largestLoser,
    avgPositionSize: positionSizeCount > 0 ? positionSizeSum / positionSizeCount : null,
  };
}
