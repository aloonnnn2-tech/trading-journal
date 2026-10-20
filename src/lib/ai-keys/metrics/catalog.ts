// What every figure in Trading Lens means, exactly as the app computes it,
// and how to judge it -- so Ask can answer "what's my MAE, and is that good?"
// for anything in the journal (Alon, 2026-10-17), without the model guessing
// at a definition or reading a bare field name.
//
// Each `definition` is written from the function that computes the figure
// (named in `source` and in the comment above each group). The VALUES never
// come from here: `source` says which of the app's own functions to call, so
// Ask quotes the same number the page shows (src/lib/ai-keys/tools/metrics.ts).
// Nothing here is a second stats implementation.
//
// `howToRead` gives direction and commonly cited rules of thumb, labelled as
// such: general knowledge to compare against, not a fact about this trader.

import type { REPORT_KINDS } from "../tools/reports";

export type MetricSource =
  /** getAnalyticsSummary -- the Analytics page's stat cards. Closed, non-investment trades. */
  | { kind: "summary"; fields: string[] }
  /** One of the computed reports (get_report), optionally narrowed to some fields. */
  | { kind: "report"; report: (typeof REPORT_KINDS)[number]; fields?: string[] }
  /** getDashboardStats -- the Dashboard cards. */
  | { kind: "dashboard"; fields: string[] }
  /** computeAttentionStreak -- the Dashboard's needs-attention streak. */
  | { kind: "attention_streak" }
  /** One trade, via get_trade (needs a trade: id, or ticker and date). */
  | { kind: "trade"; fields: string[] };

export interface MetricEntry {
  id: string;
  name: string;
  /** Other names people use for it, matched case-insensitively. */
  aliases: string[];
  /** Where it appears in the app. */
  where: string;
  /** How Trading Lens computes it. */
  definition: string;
  /** Which direction is better, and common rules of thumb (labelled as such). */
  howToRead: string;
  /** Limits of the figure: samples, exclusions, data caveats. */
  caveats: string;
  source: MetricSource;
}

const CLOSED = "Closed trades with an exit date only; investment-mode positions are excluded.";

/** The Trades page strip shows these for the current filters, and only past the stats engine's minimums. */
const STRIP_FLOOR =
  "On the Trades page summary strip it is shown for the current filters only, and only with at least 5 closed trades (5 with R for expectancy); below that the strip shows a dash with the reason.";

export const METRICS: MetricEntry[] = [
  // ---- Analytics stat cards: src/lib/analytics/queries.ts getAnalyticsSummary
  {
    id: "total_pl",
    name: "Total P/L",
    aliases: ["net p/l", "net profit", "total profit", "pnl", "p&l"],
    where: "Analytics (Total P/L card), Trades summary strip (Net P/L)",
    definition: "Sum of dollar P/L over closed trades. Dollar P/L is net of commission when a commission is recorded.",
    howToRead: "Above zero is profitable. On its own it says nothing about consistency or risk taken -- read it with drawdown, profit factor and the number of trades behind it.",
    caveats: CLOSED,
    source: { kind: "summary", fields: ["totalPL", "closedCount"] },
  },
  {
    id: "win_rate",
    name: "Win rate",
    aliases: ["winrate", "hit rate", "win %", "percentage of winners"],
    where: "Analytics, Dashboard, Trades summary strip",
    definition: "Winning trades (P/L above zero) divided by ALL closed trades. A break-even trade counts in the total but not as a win.",
    howToRead: "Meaningless without payoff: 35% wins with 3R winners is excellent, 70% wins with tiny winners and big losers is not. Commonly cited: trend-following often runs 30-45%, mean-reversion 55-70%. Judge it together with average win vs average loss and expectancy.",
    caveats: `${CLOSED} Under ~30 trades it swings a lot from luck alone. ${STRIP_FLOOR}`,
    source: { kind: "summary", fields: ["winRate", "closedCount"] },
  },
  {
    id: "profit_factor",
    name: "Profit factor",
    aliases: ["pf", "gross win over gross loss"],
    where: "Analytics, Trades summary strip",
    definition: "Total dollars won on winning trades divided by total dollars lost on losing trades. Shown as empty when there are no losing trades yet.",
    howToRead: "Above 1 means profitable overall. Commonly cited rule of thumb: 1.0-1.3 thin, 1.3-1.75 decent, 1.75-2.5 strong; well above 3 on a small sample is usually luck or very few losers so far.",
    caveats: `${CLOSED} One huge winner can carry it; check the largest winner's share. ${STRIP_FLOOR}`,
    source: { kind: "summary", fields: ["profitFactor", "closedCount"] },
  },
  {
    id: "expectancy",
    name: "Avg return per trade (expectancy, R)",
    aliases: ["expectancy", "average r", "avg r", "avg return per trade", "edge per trade", "r expectancy"],
    where: "Analytics (Avg return per trade), Trades summary strip (Expectancy)",
    definition: "The average R multiple over closed trades that have one. A trade's R multiple is its dollar P/L divided by the dollar risk entered for it, so 1R = what you planned to lose.",
    howToRead: "Above 0R is a positive edge. Commonly cited: +0.1R to +0.3R per trade is solid for active traders, above +0.5R is excellent if the sample is large. Multiply by trades per month for the expected monthly R.",
    caveats: `${CLOSED} Only trades with a risk amount carry R; trades without a stop or risk are left out, so check how many have R. ${STRIP_FLOOR}`,
    source: { kind: "summary", fields: ["expectancy", "closedCount"] },
  },
  {
    id: "avg_win_loss",
    name: "Average win / average loss",
    aliases: ["avg win", "avg loss", "average win", "average loss", "payoff ratio", "reward to risk realised", "win loss ratio"],
    where: "Analytics (Avg win, Avg loss)",
    definition: "Average dollar P/L of winning trades, and average dollar size of losing trades (shown as a positive number).",
    howToRead: "Their ratio (avg win / avg loss, the payoff ratio) decides how high the win rate must be: break-even win rate = 1 / (1 + payoff). A payoff under 1 needs a win rate over 50% just to break even.",
    caveats: CLOSED,
    source: { kind: "summary", fields: ["avgWin", "avgLoss", "winRate", "closedCount"] },
  },
  {
    id: "streaks",
    name: "Win / loss streaks",
    aliases: ["longest win streak", "longest loss streak", "current streak", "losing streak", "winning streak"],
    where: "Analytics (Longest win streak, Longest loss streak, Current streak)",
    definition: "Runs of consecutive winning or losing trades in exit order. A break-even trade neither extends nor breaks a streak.",
    howToRead: "Long losing streaks are normal at modest win rates (at a 40% win rate, 8 losses in a row happens in a few hundred trades). What matters is whether size or rule-following changes during them -- see risk_after_losses.",
    caveats: CLOSED,
    source: { kind: "summary", fields: ["longestWinStreak", "longestLossStreak", "currentStreak"] },
  },
  {
    id: "best_worst_month",
    name: "Best / worst month",
    aliases: ["best month", "worst month", "monthly p/l", "monthly returns"],
    where: "Analytics (Best month, Worst month)",
    definition: "Total P/L per calendar month in the trader's own time zone; the highest and lowest month.",
    howToRead: "A worst month far deeper than the best month is high is a warning sign of poor loss control; steady months matter more than one big one.",
    caveats: CLOSED,
    source: { kind: "summary", fields: ["bestMonth", "worstMonth", "byMonth"] },
  },
  {
    id: "avg_holding_time",
    name: "Average holding time",
    aliases: ["avg hold", "holding period", "average hold", "time in trade"],
    where: "Analytics (Avg holding time), Trades summary strip (Avg hold)",
    definition: "Average days between entry date and exit date, over closed trades that have both.",
    howToRead: "Neither good nor bad on its own -- compare it with the style: a swing trader holding winners shorter than losers is cutting winners and letting losers run (check by grouping stats on hold length).",
    caveats: CLOSED,
    source: { kind: "summary", fields: ["avgHoldingDays", "closedCount"] },
  },
  {
    id: "largest_winner_loser",
    name: "Largest winner / largest loser",
    aliases: ["largest winner", "largest loser", "largest win", "largest loss", "biggest win", "biggest loss", "best trade", "worst trade"],
    where: "Analytics (Largest winner, Largest loser)",
    definition: "The single highest and lowest dollar P/L among closed trades.",
    howToRead: "A largest loser several times the average loss means a stop wasn't respected or size was too big. A largest winner that makes up most of total P/L means results rest on one trade.",
    caveats: CLOSED,
    source: { kind: "summary", fields: ["largestWinner", "largestLoser", "avgWin", "avgLoss", "totalPL"] },
  },
  {
    id: "avg_position_size",
    name: "Average position size",
    aliases: ["position size", "average size", "avg size"],
    where: "Analytics (Avg position size)",
    definition: "Average dollar position size over closed trades that have one recorded.",
    howToRead: "Compare it with account size: commonly, one position at more than 20-25% of the account concentrates risk. Consistency matters more than the level -- see position_size_variation.",
    caveats: CLOSED,
    source: { kind: "summary", fields: ["avgPositionSize", "closedCount"] },
  },
  {
    id: "max_drawdown",
    name: "Max drawdown",
    aliases: ["drawdown", "drawdowns", "deepest drawdown", "peak to trough", "dd", "recovery"],
    where: "Analytics (Cumulative P&L chart header; Drawdowns panel)",
    definition: "The largest fall in cumulative trading P/L from a running peak, in dollars (deposits and withdrawals excluded). The Drawdowns panel lists every episode with depth, length in days, trades, and recovery.",
    howToRead: "Commonly cited: keep max drawdown under 20% of the account; deeper ones need far larger gains to recover (-50% needs +100%). Compare the current drawdown with the median and the deepest.",
    caveats: `${CLOSED} Measured on trading P/L, not account balance.`,
    source: { kind: "report", report: "drawdown" },
  },
  {
    id: "r_distribution",
    name: "R-multiple distribution",
    aliases: ["r distribution", "r histogram", "win loss size breakdown", "r multiples"],
    where: "Analytics (Win/loss size breakdown chart)",
    definition: "How many closed trades fall in each R band (e.g. -2 to -1, 1 to 2).",
    howToRead: "Healthy: losses clustered near -1R (stops respected) and a tail of winners above +2R. Losses beyond -1R mean exits later than the plan.",
    caveats: `${CLOSED} Only trades with an R multiple.`,
    source: { kind: "summary", fields: ["rMultiples"] },
  },
  {
    id: "by_direction",
    name: "Win rate by direction",
    aliases: ["win rate by direction", "win rate by direction and tag", "long vs short", "longs", "shorts", "direction"],
    where: "Analytics (Win rate by direction)",
    definition: "Trades, wins, win rate and total P/L for long and for short trades.",
    howToRead: "A side with a clearly negative total over a decent sample is worth cutting or re-thinking.",
    caveats: CLOSED,
    source: { kind: "summary", fields: ["byDirection"] },
  },
  {
    id: "by_strategy",
    name: "Win rate by strategy",
    aliases: ["win rate by tag", "by tag", "per strategy", "strategy performance", "setups"],
    where: "Analytics (Win rate by tag); Strategies scorecards go deeper",
    definition: "Trades, wins, win rate and total P/L per strategy. A trade tagged with several strategies counts in each; untagged trades form 'Untagged'.",
    howToRead: "Compare strategies by expectancy (scorecards), not win rate alone.",
    caveats: CLOSED,
    source: { kind: "summary", fields: ["byTag"] },
  },

  // ---- Reports: src/lib/ai-keys/tools/reports.ts getReport (same functions as the pages)
  {
    id: "equity_curve",
    name: "Equity curve / performance",
    aliases: ["equity", "account growth", "performance", "cumulative p/l", "net deposits"],
    where: "Analytics (Cumulative P&L chart, Performance panel)",
    definition: "Cumulative trading P/L over time and account equity (cash including deposits and withdrawals), with net deposits and max drawdown in dollars and percent.",
    howToRead: "Growth from trading should be clearly separable from growth from deposits; a rising balance with flat trading P/L is deposits, not skill.",
    caveats: CLOSED,
    source: { kind: "report", report: "equity_curve", fields: ["finalPL", "finalEquity", "netDeposits", "maxDrawdown", "maxDrawdownPercent", "trades"] },
  },
  {
    id: "mae",
    name: "MAE (maximum adverse excursion)",
    aliases: ["mae", "avg mae", "max adverse excursion", "adverse excursion", "heat", "drawdown in trade", "entries and exits (mae / mfe)", "entries and exits"],
    where: "Analytics (Entries and exits, MAE / MFE panel: Avg MAE)",
    definition: "How far price moved AGAINST the trade between entry and exit, from daily price bars. Reported as an average percent of entry price and, for trades with a stop, in R (the move divided by the entry-to-stop distance). Shown overall and for winners and losers separately.",
    howToRead: "Winners' MAE shows how much heat good trades need: if winners rarely go beyond -0.5R, a stop at -1R has room to tighten. Losers with MAE far past -1R mean stops weren't honoured. Winners with MAE near the stop mean entries are early or stops too tight.",
    caveats: "Daily bars only, so it is an OUTER BOUND (the entry day's low may predate the entry). Same-day trades are refused, not estimated. Needs the excursions calculated (Analytics: Calculate).",
    source: { kind: "report", report: "excursions" },
  },
  {
    id: "mfe",
    name: "MFE (maximum favourable excursion)",
    aliases: ["mfe", "avg mfe", "max favourable excursion", "max favorable excursion", "favourable excursion", "best in your favour", "move available", "run up"],
    where: "Analytics (MAE / MFE panel: Avg MFE, Best in your favour)",
    definition: "How far price moved IN FAVOUR of the trade between entry and exit, from daily bars: average percent of entry, and in R for trades with a stop.",
    howToRead: "Compare MFE with what was actually realised (capture). Losers that had a large MFE first are 'gave it back' trades -- a trailing stop or partial exit would have helped. MFE well above targets says targets are too close.",
    caveats: "Daily bars: an outer bound. Same-day trades refused. Needs the excursions calculated.",
    source: { kind: "report", report: "excursions" },
  },
  {
    id: "capture",
    name: "Capture ratio",
    aliases: ["capture", "captured", "median capture", "you kept", "efficiency", "exit efficiency", "gave it back", "how much of the move"],
    where: "Analytics (MAE / MFE panel: Captured, and the capture bands)",
    definition: "Share of the favourable move (MFE) that the exit kept: realised move divided by MFE on the same price basis. The panel shows the MEDIAN and the bands: Gave it back (ran your way, closed at or below entry), under 25%, 25-50%, 50-75%, over 75%.",
    howToRead: "Commonly cited: capturing 50%+ of MFE is good exit management; under 25% means exits are early or profits are given back. A big 'Gave it back' band is the one to fix first.",
    caveats: "Daily bars (outer bound). Median, not mean, on purpose: one spike exit would skew a mean.",
    source: { kind: "report", report: "excursions" },
  },
  {
    id: "risk_per_trade",
    name: "Risk per trade",
    aliases: ["risk", "risk percent", "risk %", "risk per trade", "percent risked", "sizing"],
    where: "Analytics (Risk panel)",
    definition: "The percent of the account risked per trade (from the trade's risk amount), as a spread (median, typical range) and a distribution across bands: under 0.25%, 0.25-0.5%, 0.5-1%, 1-2%, 2-5%, over 5%.",
    howToRead: "Commonly cited: 0.5-1% per trade for most traders, 2% as an upper limit; anything over 5% is gambling-sized. Consistency matters as much as the level.",
    caveats: "Only trades with a risk percentage recorded.",
    source: { kind: "report", report: "risk", fields: ["tradesConsidered", "risk", "distribution"] },
  },
  {
    id: "risk_after_losses",
    name: "Risk after losses / in drawdown",
    aliases: ["revenge trading", "tilt", "sizing after loss", "risk after win", "risk in drawdown"],
    where: "Analytics (Risk panel)",
    definition: "Risk taken on the trade right after a loss vs after a win, and while the account sat below its peak vs at highs. Also risk on trades that went on to win vs lose (descriptive only).",
    howToRead: "Risk rising after losses or in drawdown is the classic revenge-sizing pattern -- the single most account-damaging habit. Falling slightly is fine; rising is a red flag.",
    caveats: "Risking more does not cause a loss: the winners vs losers pair is descriptive, not causal.",
    source: { kind: "report", report: "risk", fields: ["sequence", "drawdown", "outcome"] },
  },
  {
    id: "position_size_variation",
    name: "Position size variation",
    aliases: ["size variation", "sizing consistency", "inconsistent size"],
    where: "Analytics (Risk panel)",
    definition: "Spread of position size relative to its own average (a coefficient of variation), plus outlier trades sized far from the trader's norm.",
    howToRead: "Not good or bad by itself; high variation with no reason (e.g. no conviction rule) usually means emotional sizing. Look at the outliers.",
    caveats: "Only trades with a position size recorded.",
    source: { kind: "report", report: "risk", fields: ["positionSize", "positionSizeVariation", "outliers"] },
  },
  {
    id: "regime",
    name: "Market conditions (volatility regime)",
    aliases: ["regime", "market conditions", "volatility", "trending vs choppy"],
    where: "Analytics (Market conditions panel)",
    definition: "Performance in high vs low market volatility, measured on a benchmark index around each trade's dates: trades, win rate, expectancy and P/L per band.",
    howToRead: "A clear gap tells the trader when to size down or sit out. Needs enough trades in each band to mean anything.",
    caveats: "Asset types the benchmark index does not fit are excluded (excludedByAsset), and trades with no benchmark data for their dates are unmatched.",
    source: { kind: "report", report: "regime" },
  },
  {
    id: "edge_leaks",
    name: "Edges and leaks",
    aliases: ["edge", "leaks", "biggest edge", "biggest leak", "find my edge", "what works"],
    where: "Insights (Find My Edge)",
    definition: "Every way of cutting the trades (strategy, direction, instrument, weekday, hold length, risk band, emotion, exit behaviour) ranked by expectancy in R vs the overall expectancy; the best are edges, the worst are leaks.",
    howToRead: "An edge or leak with few trades is a lead, not a conclusion. Doing more of the edges and cutting the leaks is the most direct improvement.",
    caveats: "Segments need at least 5 trades (and 5 with R) to be ranked.",
    source: { kind: "report", report: "edge" },
  },
  {
    id: "scorecards",
    name: "Strategy scorecards",
    aliases: ["scorecard", "strategy scorecard", "best strategy", "worst strategy"],
    where: "Strategies (Scorecards)",
    definition: "Per strategy: trades, win rate, expectancy in R, total P/L, a trend comparing the recent half of its trades with the earlier half, and its best and worst condition.",
    howToRead: "Rank strategies by expectancy and sample size; a declining trend on a good strategy is worth a look before it becomes a leak.",
    caveats: "Strategies below the trade floor are listed separately (belowFloor).",
    source: { kind: "report", report: "scorecards" },
  },
  {
    id: "mistakes",
    name: "Mistakes",
    aliases: ["mistake", "biggest mistake", "errors", "moved stop", "oversized", "early exit"],
    where: "Insights (Mistakes)",
    definition: "Mistakes tagged by the trader plus ones detected from the data (e.g. moved stops, oversized positions, early exits). For each: how often, and expectancy with the mistake vs without it (the expectancy gap, in R).",
    howToRead: "A big negative gap on a frequent mistake is the most expensive habit to fix. It's a comparison of two groups, not proof the mistake caused the loss.",
    caveats: "The gap is shown only when both groups have at least 5 trades.",
    source: { kind: "report", report: "mistakes" },
  },
  {
    id: "insights",
    name: "Insights (patterns)",
    aliases: ["patterns", "insight", "win rate by day", "emotion insights"],
    where: "Insights (pattern cards)",
    definition: "Segments whose win rate differs meaningfully from the overall win rate: day of week, direction, strategy, emotion, risk band.",
    howToRead: "Each is a lead to check against expectancy; a win rate gap alone can hide a payoff difference.",
    caveats: "Each needs at least 5 trades in the segment.",
    source: { kind: "report", report: "insights" },
  },
  {
    id: "emotion_results",
    name: "Results by emotion",
    aliases: ["emotions", "emotion", "by emotion", "feelings", "fomo", "intensity", "emotion intensity", "emotions over time"],
    where: "Emotions page (menu: Analysis, Emotions)",
    definition: "Closed trades grouped by each emotion the trader logged before entering, during, and after exiting, and by how intense it was (1-3, 4-6, 7-10): trades, win rate, average R, total P/L and profit factor for each. A trade with two emotions counts under both.",
    howToRead: "Look for the emotions with clearly negative average R on a decent sample -- those are the states to stop trading in. Compare before vs during vs after: an emotion during the trade often explains the exit.",
    caveats: "Only trades where an emotion was logged; rows on fewer than 5 trades are shown faded and not judged. It's a comparison of groups, not proof the feeling caused the result.",
    source: { kind: "report", report: "emotions", fields: ["closedTrades", "loggedTrades", "byPhase", "byIntensity", "periods"] },
  },
  {
    id: "tilt",
    name: "Trading after losses (tilt)",
    aliases: ["tilt", "revenge trading", "after losses", "losing streak behaviour", "after a loss"],
    where: "Emotions page (Trading after losses)",
    definition: "Closed trades split by the losing streak that had already closed when each was opened: after 2+ losses in a row, after 1 loss, or otherwise. For each group: win rate, average R, P/L, the size against the trader's median size, and the emotion most often logged.",
    howToRead: "Worse average R AND worse P/L per trade after streaks, especially with bigger size, is tilt. When R and dollars disagree, position size is usually why.",
    caveats: "Needs at least 5 trades in a group to judge. A streak counts only trades closed before the next was opened.",
    source: { kind: "report", report: "emotions", fields: ["tilt"] },
  },
  {
    id: "emotion_mistakes",
    name: "Emotions before mistakes",
    aliases: ["emotions before mistakes", "emotion mistakes", "which emotions lead to mistakes"],
    where: "Emotions page (Emotions before mistakes)",
    definition: "For each emotion logged before entering: the share of those trades that broke a plan rule or carry a mistake (tagged or detected), against the share across all closed trades, and the most common mistakes among them.",
    howToRead: "An emotion with a clearly higher mistake rate than overall is a warning sign to pause on.",
    caveats: "Same 5-trade floor; mistakes come from the same sources as the Insights mistake tracker.",
    source: { kind: "report", report: "emotions", fields: ["mistakes"] },
  },
  {
    id: "goals",
    name: "Goals",
    aliases: ["goal", "targets", "progress"],
    where: "Goals page (menu: Analysis, Goals)",
    definition: "The trader's own goals, each scored from trades for its period: current value, target, whether it's met, and the sample behind it.",
    howToRead: "Process goals (risk, rules followed) predict results better than P/L goals.",
    caveats: "Scored from trades only; nothing is ticked off by hand.",
    source: { kind: "report", report: "goals" },
  },

  // ---- Dashboard: src/lib/dashboard/queries.ts getDashboardStats, src/lib/trades/streak.ts
  {
    id: "today_pl",
    name: "Today's P/L",
    aliases: ["today", "today's p/l", "daily p/l", "p/l today"],
    where: "Dashboard (Today's P/L)",
    definition: "Total P/L of trades closed today, in the trader's own time zone.",
    howToRead: "One day is noise; useful mainly against a daily loss limit if they have one.",
    caveats: "Closed trades only; open positions' floating P/L is not included.",
    source: { kind: "dashboard", fields: ["todayPL"] },
  },
  {
    id: "trade_counts",
    name: "Pending / open / closed trades",
    aliases: ["trades", "open trades", "pending orders", "closed trades", "how many trades"],
    where: "Dashboard (Pending orders, Open trades, Closed trades)",
    definition: "Counts of trades by status.",
    howToRead: "Many open positions at once concentrate risk; check total open risk against the account.",
    caveats: "Counts every mode, investments included.",
    source: { kind: "dashboard", fields: ["counts"] },
  },
  {
    id: "best_worst_setup",
    name: "Best / worst setup",
    aliases: ["best setup", "worst setup", "best strategy this month"],
    where: "Dashboard (Best setup, Worst setup)",
    definition: "The strategies with the highest and lowest total P/L over closed trades (investments excluded). With only one strategy, no worst is shown.",
    howToRead: "Ranked by total P/L, so a strategy traded often can top it on volume alone; the Strategies scorecards rank by expectancy and give the fuller picture.",
    caveats: "Small samples move it a lot.",
    source: { kind: "dashboard", fields: ["bestWorstSetup"] },
  },
  {
    id: "account_cash",
    name: "Account cash",
    aliases: ["account balance", "cash", "available cash", "balance"],
    where: "Dashboard (Account cash)",
    definition: "Deposits minus withdrawals plus realised trading P/L. Available cash also subtracts money tied up in open positions and set aside for pending orders.",
    howToRead: "The base that risk percentages and returns are measured against -- keep it current or every percentage is off.",
    caveats: "Only as accurate as the deposits and withdrawals recorded.",
    source: { kind: "dashboard", fields: ["accountBalance"] },
  },
  {
    id: "attention_streak",
    name: "Needs-attention streak",
    aliases: ["streak", "journaling streak", "needs attention", "logging streak", "fully filled"],
    where: "Dashboard (Needs-attention streak)",
    definition: "Consecutive days (in the trader's time zone) with at least one trade logged that day whose required fields are all filled in. Today doesn't break it until the day is over.",
    howToRead: "A journaling-discipline measure: complete records are what make every other figure here trustworthy.",
    caveats: "Judged on each trade's current fields, so completing an old trade later can repair a past day.",
    source: { kind: "attention_streak" },
  },

  // ---- One trade: src/lib/ai-keys/tools/journal.ts getTrade
  {
    id: "r_multiple",
    name: "R multiple (one trade)",
    aliases: ["r", "r multiple", "r-multiple", "how many r"],
    where: "Trade page (R), trades list",
    definition: "The trade's dollar P/L divided by the dollar risk entered for it (risk amount): +2R made twice what was risked, -1R lost exactly the planned amount.",
    howToRead: "Losses worse than -1R mean the exit came after the planned stop. Across trades, the average is the expectancy.",
    caveats: "Needs a risk amount on the trade; without one the trade has no R.",
    source: { kind: "trade", fields: ["r_multiple", "dollar_pl", "risk_amount", "stop_loss", "entry_price", "exit_price"] },
  },
  {
    id: "risk_reward",
    name: "Risk:reward (one trade)",
    aliases: ["r:r", "rr", "risk reward", "reward to risk", "planned r"],
    where: "Trade page, trades list (R:R)",
    definition: "The planned reward-to-risk: distance from entry to take-profit divided by distance from entry to stop. Deliberately before fees, so it compares across sizes; the fee-aware counterpart is the break-even price.",
    howToRead: "Commonly cited minimum: 1.5-2:1 for setups with near-50% win rates. A high planned R:R that is never reached (see capture) is optimistic targeting.",
    caveats: "Needs entry, stop and take-profit on the trade.",
    source: { kind: "trade", fields: ["risk_reward_ratio", "entry_price", "stop_loss", "take_profit"] },
  },
  {
    id: "plan_adherence",
    name: "Plan adherence (rules followed)",
    aliases: ["adherence", "rules followed", "followed my rules", "plan rules"],
    where: "Trade page (Plan adherence); goals can track it",
    definition: "For each strategy the trade is tagged with, which of that strategy's rules were checked as followed.",
    howToRead: "Trades that broke rules vs followed them is often the clearest split in results; compare them with compute_stats or the mistakes report.",
    caveats: "Only for trades tagged with a strategy that has rules.",
    source: { kind: "trade", fields: ["adherence", "strategies"] },
  },
];

export const METRIC_IDS: string[] = METRICS.map((m) => m.id);

/** Finds a metric by id, name or alias, ignoring case and punctuation. */
export function findMetric(query: string): MetricEntry | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%:/&+]+/g, " ").trim();
  const q = norm(query);
  if (!q) return null;
  for (const m of METRICS) {
    if (norm(m.id) === q || norm(m.name) === q || m.aliases.some((a) => norm(a) === q)) return m;
  }
  // A looser second pass: the query contains a name or alias ("my mae please").
  for (const m of METRICS) {
    const names = [m.id.replace(/_/g, " "), m.name, ...m.aliases].map(norm).filter((n) => n.length >= 2);
    if (names.some((n) => new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(q))) return m;
  }
  return null;
}
