import { z } from "zod";
import type { AnalyticsSummary } from "@/lib/analytics/queries";
import { buildTradingReport } from "@/lib/report/build";
import { previousPeriod, resolvePeriod } from "@/lib/ai-reviews/period";
import { localDateParts } from "@/lib/dates/local-day";
import { getEquityCurve } from "@/lib/equity/queries";
import { buildDrawdownReport } from "@/lib/drawdown/episodes";
import { getEdgeReport } from "@/lib/edge/queries";
import { getScorecards } from "@/lib/scorecards/queries";
import { getInsights } from "@/lib/insights/queries";
import { getRiskReport } from "@/lib/risk/queries";
import { getRegimeReport } from "@/lib/regime/queries";
import { getMistakeReport } from "@/lib/mistakes/queries";
import { listGoals, getGoalProgress } from "@/lib/goals/queries";
import { getExcursionReport } from "@/lib/excursions/report";
import { getTradeReview, listPeriodReviews } from "@/lib/ai-reviews/queries";
import { limited, toolError } from "./envelope";
import { round } from "./filter";
import type { ToolContext } from "./journal";

// The computed analytics, exposed as tools. `get_report` is ONE tool with an
// enum rather than ten separate tools: each tool definition costs ~200
// prompt tokens on every turn, and on Groq's 8 000 tokens/minute budget ten
// of them would eat most of it before the question arrived.

export const REPORT_KINDS = [
  "equity_curve",
  "drawdown",
  "edge",
  "scorecards",
  "insights",
  "risk",
  "regime",
  "mistakes",
  "goals",
  "excursions",
] as const;

/**
 * Period names as a person means them, not as the review feature does. The
 * review resolver's "monthly" is deliberately the PREVIOUS completed month
 * (a partial month is a moving target for a review); asked "how is this
 * month going?" on the 20th, the chat must answer about the current one.
 */
export const PERIOD_CHOICES = ["this_week", "last_7_days", "last_week", "this_month", "last_month", "custom"] as const;

export const getPeriodReportSchema = z
  .object({
    period: z.enum(PERIOD_CHOICES),
    start: z.string().max(10).optional(),
    end: z.string().max(10).optional(),
    compare_previous: z.boolean().optional(),
  })
  .strict();

export const getReportSchema = z.object({ kind: z.enum(REPORT_KINDS) }).strict();

export const getReviewsSchema = z
  .object({
    trade_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

// ---- helpers ---------------------------------------------------------------

/** The headline numbers of a summary, without the per-trade equity curve. */
function compactSummary(s: AnalyticsSummary) {
  return {
    closedTrades: s.closedCount,
    totalPL: round(s.totalPL),
    winRate: round(s.winRate, 4),
    profitFactor: round(s.profitFactor, 3),
    expectancyR: round(s.expectancy, 3),
    avgWin: round(s.avgWin),
    avgLoss: round(s.avgLoss),
    maxDrawdown: round(s.maxDrawdown),
    longestWinStreak: s.longestWinStreak,
    longestLossStreak: s.longestLossStreak,
    currentStreak: s.currentStreak,
    avgHoldingDays: round(s.avgHoldingDays, 1),
    avgPositionSize: round(s.avgPositionSize),
    bestMonth: s.bestMonth,
    worstMonth: s.worstMonth,
    byMonth: s.byMonth,
    byDirection: s.byDirection,
    byStrategy: s.byTag,
    rMultiples: s.rMultiples,
  };
}

/** Keeps at most `max` evenly spaced points so a long history stays cheap. */
function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

// ---- executors ---------------------------------------------------------------

// localDateParts returns a 0-INDEXED month, matching JS Date. Every
// conversion below goes through these two helpers so that fact lives in
// exactly one place -- the first version of this file assumed 1-based and
// resolved "this month" to the previous one.
function ymd(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Calendar arithmetic on a local Y-M-D (0-indexed month), zone-independent once resolved. */
function shift(d: { year: number; month: number; day: number }, days: number) {
  const t = new Date(Date.UTC(d.year, d.month, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth(), day: t.getUTCDate() };
}

export function resolveChoice(choice: (typeof PERIOD_CHOICES)[number], tz: string | null, custom?: { start?: string; end?: string }) {
  const today = localDateParts(new Date(), tz);
  // Monday-start weeks; getUTCDay on the local Y-M-D gives its weekday.
  const dow = new Date(Date.UTC(today.year, today.month, today.day)).getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dow + 6) % 7;
  switch (choice) {
    case "this_month":
      return resolvePeriod("custom", tz, new Date(), { startDate: ymd({ ...today, day: 1 }), endDate: ymd(today) });
    case "last_month":
      return resolvePeriod("monthly", tz);
    case "this_week":
      return resolvePeriod("custom", tz, new Date(), { startDate: ymd(shift(today, -daysSinceMonday)), endDate: ymd(today) });
    case "last_week": {
      const lastMonday = shift(today, -daysSinceMonday - 7);
      return resolvePeriod("custom", tz, new Date(), { startDate: ymd(lastMonday), endDate: ymd(shift(lastMonday, 6)) });
    }
    case "last_7_days":
      return resolvePeriod("weekly", tz);
    case "custom":
      if (!custom?.start || !custom?.end) return null;
      return resolvePeriod("custom", tz, new Date(), { startDate: custom.start, endDate: custom.end });
  }
}

export async function getPeriodReport(ctx: ToolContext, args: z.infer<typeof getPeriodReportSchema>) {
  if (args.period === "custom" && (!args.start || !args.end)) {
    return toolError("custom period needs start and end as YYYY-MM-DD");
  }
  const period = resolveChoice(args.period, ctx.timezone, { start: args.start, end: args.end });
  if (!period) return toolError("could not resolve that period");

  const report = await buildTradingReport(ctx.supabase, period, ctx.timezone);
  const out: Record<string, unknown> = {
    period: { label: period.label, from: period.startDate, to: period.endDate },
    tradesAnalysed: report.tradesAnalysed,
    summary: compactSummary(report.summary),
    bestStrategy: report.bestStrategy ? { name: report.bestStrategy.value, trades: report.bestStrategy.stats.trades, expectancyR: round(report.bestStrategy.stats.expectancy, 3) } : null,
    worstStrategy: report.worstStrategy ? { name: report.worstStrategy.value, trades: report.worstStrategy.stats.trades, expectancyR: round(report.worstStrategy.stats.expectancy, 3) } : null,
    biggestMistake: report.biggestMistake,
    bestTrade: report.bestTrade,
    worstTrade: report.worstTrade,
    risk: report.risk,
  };

  if (args.compare_previous) {
    // A month-to-date compares against the WHOLE previous month, and a
    // week-to-date against the whole previous week -- not against "the same
    // number of days before", which is what previousPeriod() does for a
    // custom range (asked on the 20th, that produced "last month = 12th–31st").
    const prev =
      args.period === "this_month"
        ? resolveChoice("last_month", ctx.timezone)
        : args.period === "this_week"
          ? resolveChoice("last_week", ctx.timezone)
          : previousPeriod(period, ctx.timezone);
    if (prev) {
      const prevSummary = await ctx.store.summary({ startIso: prev.startIso, endIso: prev.endIso });
      const cur = report.summary;
      out.previous = { period: { label: prev.label, from: prev.startDate, to: prev.endDate }, summary: compactSummary(prevSummary) };
      out.delta = {
        totalPL: round(cur.totalPL - prevSummary.totalPL),
        winRate: round((cur.winRate ?? 0) - (prevSummary.winRate ?? 0), 4),
        expectancyR: round((cur.expectancy ?? 0) - (prevSummary.expectancy ?? 0), 3),
        closedTrades: cur.closedCount - prevSummary.closedCount,
      };
    }
  }
  return out;
}

export async function getReport(ctx: ToolContext, args: z.infer<typeof getReportSchema>) {
  const { supabase, timezone } = ctx;
  switch (args.kind) {
    case "equity_curve": {
      const c = await getEquityCurve(supabase);
      return {
        finalPL: round(c.finalPL),
        finalEquity: round(c.finalEquity),
        netDeposits: round(c.netDeposits),
        maxDrawdown: round(c.maxDrawdown),
        maxDrawdownPercent: round(c.maxDrawdownPercent, 2),
        trades: c.trades,
        points: downsample(c.points, 120).map((p) => ({
          date: p.date,
          cumulativePL: round(p.cumulativePL),
          equity: round(p.accountEquity),
          drawdown: round(p.drawdown),
        })),
      };
    }
    case "drawdown": {
      const c = await getEquityCurve(supabase);
      const d = buildDrawdownReport(c.points);
      const ep = (e: (typeof d.episodes)[number] | null) =>
        e ? { start: e.startDate, trough: e.troughDate, recovered: e.recoveredDate, depth: round(e.depth), depthPercent: round(e.depthPercent, 2), days: e.days, trades: e.trades } : null;
      return {
        current: ep(d.current),
        deepest: ep(d.deepest),
        longest: ep(d.longest),
        currentIsDeepest: d.currentIsDeepest,
        medianDepth: round(d.medianDepth),
        medianDays: d.medianDays,
        medianTradesToRecover: d.medianTradesToRecover,
        episodes: limited(d.episodes.map(ep), 10),
      };
    }
    case "edge": {
      const r = await getEdgeReport(supabase, timezone);
      const seg = (s: (typeof r.edges)[number]) => ({ dimension: s.dimensionLabel, value: s.value, trades: s.stats.trades, winRate: round(s.stats.winRate, 4), expectancyR: round(s.stats.expectancy, 3), totalPL: round(s.stats.totalPL) });
      return { tradesAnalysed: r.tradesAnalysed, overallExpectancyR: round(r.overallExpectancy, 3), edges: r.edges.slice(0, 10).map(seg), leaks: r.leaks.slice(0, 10).map(seg) };
    }
    case "scorecards": {
      const r = await getScorecards(supabase, timezone);
      return {
        tradesAnalysed: r.tradesAnalysed,
        belowFloor: r.belowFloor,
        scorecards: r.scorecards.slice(0, 20).map((c) => ({
          strategy: c.strategy.name,
          trades: c.overall.trades,
          winRate: round(c.overall.winRate, 4),
          expectancyR: round(c.overall.expectancy, 3),
          totalPL: round(c.overall.totalPL),
          trend: c.trend,
          bestCondition: c.bestCondition ? { condition: `${c.bestCondition.dimensionLabel}: ${c.bestCondition.value}`, expectancyR: round(c.bestCondition.stats.expectancy, 3) } : null,
          worstCondition: c.worstCondition ? { condition: `${c.worstCondition.dimensionLabel}: ${c.worstCondition.value}`, expectancyR: round(c.worstCondition.stats.expectancy, 3) } : null,
        })),
      };
    }
    case "insights":
      return { insights: limited(await getInsights(supabase, timezone), 20) };
    case "risk":
      return await getRiskReport(supabase);
    case "regime": {
      // The report carries every trade in each band; the model needs the
      // per-band statistics, not the rows.
      const r = await getRegimeReport(supabase);
      return {
        available: r.available,
        benchmark: r.benchmark,
        medianVolatility: round(r.medianVolatility, 4),
        tradesAnalysed: r.tradesAnalysed,
        excludedByAsset: r.excludedByAsset,
        unmatched: r.unmatched,
        bands: r.segments.map((s) => ({
          band: s.value,
          trades: s.stats.trades,
          winRate: round(s.stats.winRate, 4),
          expectancyR: round(s.stats.expectancy, 3),
          totalPL: round(s.stats.totalPL),
        })),
      };
    }
    case "mistakes": {
      const r = await getMistakeReport(supabase);
      return {
        tradesAnalysed: r.tradesAnalysed,
        nothingTagged: r.nothingTagged,
        mistakes: limited(
          r.summaries.map((m) => ({ label: m.label, sources: m.sources, trades: m.tradeIds.length, withMistake: m.withMistake, withoutMistake: m.withoutMistake, expectancyGap: round(m.expectancyGap, 3) })),
          20,
        ),
      };
    }
    case "goals": {
      const [goals, progress] = await Promise.all([listGoals(supabase), getGoalProgress(supabase, timezone)]);
      return {
        goals: limited(
          goals.map((g) => {
            const p = progress.find((x) => x.goal.id === g.id);
            return { label: g.label, kind: g.kind, period: g.period, target: g.target, direction: g.target_direction, active: g.active, current: p?.current ?? null, met: p?.met ?? null, sample: p?.sample ?? null, reason: p?.reason ?? null };
          }),
          30,
        ),
      };
    }
    case "excursions": {
      const r = await getExcursionReport(supabase);
      return {
        overall: r.overall,
        winners: r.winners,
        losers: r.losers,
        byStrategy: limited(r.byStrategy, 20),
        unavailable: r.unavailable,
        notComputed: r.notComputed,
      };
    }
  }
}

export async function getReviews(ctx: ToolContext, args: z.infer<typeof getReviewsSchema>) {
  // A review is a long structured text. Clip each to a share of the tier's
  // output ceiling so a handful of them fits, rather than one filling it.
  const perReview = Math.max(600, Math.min(4_000, Math.floor(ctx.outputBudget / 3)));
  const clip = (c: unknown) => {
    const s = JSON.stringify(c);
    return s.length > perReview ? `${s.slice(0, perReview - 3)}...` : s;
  };
  if (args.trade_id) {
    const r = await getTradeReview(ctx.supabase, args.trade_id);
    if (!r) return { found: false };
    return { found: true, review: { type: r.review_type, provider: r.provider, model: r.model, created: r.created_at, content: clip(r.content) } };
  }
  const reviews = await listPeriodReviews(ctx.supabase);
  return limited(
    reviews.map((r) => ({ type: r.review_type, from: r.period_start, to: r.period_end, tradesAnalysed: r.trades_analyzed, provider: r.provider, created: r.created_at, content: clip(r.content) })),
    args.limit ?? 5,
  );
}
