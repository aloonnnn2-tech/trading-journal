import type { ToolCall } from "../providers/types";
import type { BenchJournal, Group } from "./journal";
import type { Fact } from "./score";

// The Ask benchmark: questions a trader actually asks, each with the facts a
// right answer must state. Run with `npm run ask:bench` (scripts/ask-bench).
//
// - `calls` is one good way to answer: the "no key" run replays it through
//   the real tool executor and checks every fact is reachable.
// - `tools` is what a model may reasonably call; the live run counts a hit
//   when it used any of them.
// - `facts` are computed from the journal (journal.ts), never typed in. A
//   fact whose value the journal doesn't have (no MAE rows yet, no NVDA
//   trade) is dropped rather than scored, so the benchmark never demands a
//   number that doesn't exist.
// - `needsNetwork` marks a question whose tool reaches outside (market data);
//   a failure there may be the network, not Ask.

export interface BenchQuestion {
  id: string;
  question: string;
  calls: ToolCall[];
  tools: string[];
  facts: (j: BenchJournal) => (Fact | null)[];
  needsNetwork?: boolean;
}

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `bench-${name}`, name, args };
}

function num(label: string, value: number | null | undefined, percent = false): Fact | null {
  return typeof value === "number" && Number.isFinite(value) ? { label, number: value, percent } : null;
}

function best(groups: Group[]): Group | null {
  return groups.length ? groups.reduce((a, b) => (b.totalPL > a.totalPL ? b : a)) : null;
}

function worst(groups: Group[]): Group | null {
  return groups.length ? groups.reduce((a, b) => (b.totalPL < a.totalPL ? b : a)) : null;
}

/** The group's name and its P/L, or nothing when the journal has no such group. */
function groupFacts(g: Group | null): (Fact | null)[] {
  if (!g) return [];
  return [{ label: `name "${g.group}"`, text: [g.group] }, num(`P/L of ${g.group}`, g.totalPL)];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-05" as the ways an answer may write it. */
function monthNames(month: string): string[] {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m) return [month];
  const name = MONTHS[Number(m[2]) - 1];
  return [month, `${name} ${m[1]}`, `${name.slice(0, 3)} ${m[1]}`];
}

export const BENCH: BenchQuestion[] = [
  {
    id: "total_pl",
    question: "What's my total P/L?",
    calls: [call("compute_stats")],
    tools: ["compute_stats", "explain_metric", "get_report"],
    facts: (j) => [num("total P/L", j.summary.totalPL)],
  },
  {
    id: "win_rate",
    question: "What's my win rate?",
    calls: [call("compute_stats")],
    tools: ["compute_stats", "explain_metric"],
    facts: (j) => [num("win rate", j.summary.winRate, true)],
  },
  {
    id: "profit_factor",
    question: "Is my profit factor good?",
    calls: [call("explain_metric", { metric: "profit factor" })],
    tools: ["explain_metric", "compute_stats"],
    facts: (j) => [num("profit factor", j.summary.profitFactor)],
  },
  {
    id: "expectancy",
    question: "What's my expectancy per trade, and what does it mean?",
    calls: [call("explain_metric", { metric: "expectancy" })],
    tools: ["explain_metric"],
    facts: (j) => [num("expectancy", j.summary.expectancy)],
  },
  {
    id: "mae_mfe",
    question: "What's my MAE and MFE, and are they good or bad?",
    calls: [call("explain_metric", { metric: "MAE" }), call("explain_metric", { metric: "MFE" })],
    tools: ["explain_metric", "get_report"],
    facts: (j) => [num("average MAE %", j.excursions.avgMaePercent), num("average MFE %", j.excursions.avgMfePercent)],
  },
  {
    id: "capture",
    question: "How much of the move do I usually capture before I exit?",
    calls: [call("explain_metric", { metric: "capture" })],
    tools: ["explain_metric", "get_report"],
    facts: (j) => [num("median capture", j.excursions.medianCapture, true)],
  },
  {
    id: "drawdown",
    question: "What's my max drawdown?",
    calls: [call("explain_metric", { metric: "max drawdown" })],
    tools: ["explain_metric", "get_report"],
    facts: (j) => [num("max drawdown", j.summary.maxDrawdown)],
  },
  {
    id: "worst_setup",
    question: "Which setup is losing me the most money?",
    calls: [call("compute_stats", { group_by: "strategy" })],
    tools: ["compute_stats", "get_report", "explain_metric"],
    facts: (j) => groupFacts(worst(j.groups.strategy)),
  },
  {
    id: "best_setup",
    question: "Which of my strategies makes me the most?",
    calls: [call("compute_stats", { group_by: "strategy" })],
    tools: ["compute_stats", "get_report", "explain_metric"],
    facts: (j) => groupFacts(best(j.groups.strategy)),
  },
  {
    id: "best_day",
    question: "Which day of the week do I trade best?",
    calls: [call("compute_stats", { group_by: "day_of_week" })],
    tools: ["compute_stats", "get_report"],
    facts: (j) => groupFacts(best(j.groups.day_of_week)),
  },
  {
    id: "worst_hour",
    question: "What time of day am I worst at?",
    calls: [call("compute_stats", { group_by: "hour_of_day" })],
    tools: ["compute_stats", "get_report"],
    facts: (j) => groupFacts(worst(j.groups.hour_of_day)),
  },
  {
    id: "best_month",
    question: "What was my best month?",
    calls: [call("explain_metric", { metric: "best month" })],
    tools: ["explain_metric", "compute_stats", "get_report"],
    facts: (j) =>
      j.summary.bestMonth
        ? [{ label: "best month", text: monthNames(j.summary.bestMonth.month) }, num("best month P/L", j.summary.bestMonth.totalPL)]
        : [],
  },
  {
    id: "loss_streak",
    question: "What's my longest losing streak?",
    calls: [call("explain_metric", { metric: "streaks" })],
    tools: ["explain_metric"],
    facts: (j) => [num("longest losing streak", j.summary.longestLossStreak)],
  },
  {
    id: "holding_time",
    question: "How long do I hold my trades on average?",
    calls: [call("explain_metric", { metric: "average holding time" })],
    tools: ["explain_metric", "compute_stats"],
    facts: (j) => [num("average holding days", j.summary.avgHoldingDays)],
  },
  {
    id: "biggest_winner",
    question: "What's the biggest winning trade I've had?",
    calls: [call("compute_stats")],
    tools: ["compute_stats", "query_trades", "explain_metric"],
    facts: (j) => [num("largest winner", j.summary.largestWinner)],
  },
  {
    id: "long_vs_short",
    question: "Am I better at longs or shorts?",
    calls: [call("compute_stats", { group_by: "direction" })],
    tools: ["compute_stats", "explain_metric"],
    facts: (j) => j.summary.byDirection.map((d) => num(`${d.direction} win rate`, d.winRate, true)),
  },
  {
    id: "worst_emotion",
    question: "Which emotion before a trade costs me the most?",
    calls: [call("compute_stats", { group_by: "emotion_before" })],
    tools: ["compute_stats", "get_report"],
    facts: (j) => groupFacts(worst(j.groups.emotion_before)),
  },
  {
    id: "last_nvda",
    question: "Tell me about my last NVDA trade.",
    calls: [call("get_trade", { ticker: "NVDA" })],
    tools: ["get_trade", "query_trades"],
    facts: (j) =>
      j.latestNvda ? [num("NVDA entry price", j.latestNvda.entry_price), num("NVDA P/L", j.latestNvda.dollar_pl)] : [],
  },
  {
    id: "position_size",
    question: "If I risk 1% of a $25,000 account with a $2 stop, how many shares can I buy?",
    calls: [call("calculate", { expression: "25000 * 0.01 / 2" })],
    tools: ["calculate"],
    facts: () => [num("shares", 125)],
  },
  {
    id: "nvda_view",
    question: "What do you think of NVDA here? Would you buy it?",
    calls: [call("get_market_data", { symbol: "NVDA" })],
    tools: ["get_market_data"],
    facts: () => [{ label: "names NVDA", text: ["NVDA", "Nvidia"] }],
    needsNetwork: true,
  },
  {
    id: "nvda_news",
    question: "Any news on NVDA lately?",
    calls: [call("get_market_data", { symbol: "NVDA", news: true })],
    tools: ["get_market_data"],
    facts: () => [{ label: "names NVDA", text: ["NVDA", "Nvidia"] }],
    needsNetwork: true,
  },
];

/** The question's facts with the ones this journal can't supply dropped. */
export function factsFor(q: BenchQuestion, j: BenchJournal): Fact[] {
  return q.facts(j).filter((f): f is Fact => f !== null);
}
