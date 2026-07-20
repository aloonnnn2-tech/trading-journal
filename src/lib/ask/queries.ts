import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocalDayName, WEEKDAY_ORDER } from "@/lib/dates/day-of-week";

const EMOTION_BEFORE_KEY = "emotion_before";
const EMOTION_INTENSITY_KEY = "emotion_intensity";

const MIN_SAMPLE_SIZE = 3;

export interface AskAnswer {
  id: string;
  category: "performance" | "psychology" | "risk" | "streaks";
  headline: string;
  subtext: string;
  chart?: { label: string; winRate: number; trades: number }[];
  highlightLabel?: string;
  noData: boolean;
}

interface SegmentStats {
  trades: number;
  wins: number;
  totalR: number;
  rCount: number;
  totalPL: number;
}

function emptySegment(): SegmentStats {
  return { trades: 0, wins: 0, totalR: 0, rCount: 0, totalPL: 0 };
}

function addToSegment(
  map: Map<string, SegmentStats>,
  key: string,
  won: boolean,
  r: number | null,
  pl: number | null,
) {
  const s = map.get(key) ?? emptySegment();
  s.trades += 1;
  if (won) s.wins += 1;
  if (r !== null) { s.totalR += r; s.rCount += 1; }
  if (pl !== null) s.totalPL += pl;
  map.set(key, s);
}

function winRate(s: SegmentStats): number {
  return s.trades === 0 ? 0 : s.wins / s.trades;
}

function avgR(s: SegmentStats): number | null {
  return s.rCount === 0 ? null : s.totalR / s.rCount;
}

function fmt(n: number, decimals = 0): string {
  return n.toFixed(decimals);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function mapToChart(map: Map<string, SegmentStats>): { label: string; winRate: number; trades: number }[] {
  return Array.from(map.entries())
    .filter(([, s]) => s.trades >= MIN_SAMPLE_SIZE)
    .map(([label, s]) => ({ label, winRate: winRate(s), trades: s.trades }));
}

interface TwoSideComparison {
  kind: "both" | "single" | "none";
  betterLabel?: string;
  betterPct?: number;
  worseLabel?: string;
  worsePct?: number;
}

// Compares two labeled win-rate buckets, only declaring a "better" side once
// it clears MIN_SAMPLE_SIZE trades — otherwise a single lucky/unlucky trade
// can produce a misleading "100% vs 0%" headline.
function compareTwoSides(
  labelA: string,
  tradesA: number,
  winsA: number,
  labelB: string,
  tradesB: number,
  winsB: number,
): TwoSideComparison {
  const aOk = tradesA >= MIN_SAMPLE_SIZE;
  const bOk = tradesB >= MIN_SAMPLE_SIZE;
  const pctA = tradesA > 0 ? (winsA / tradesA) * 100 : 0;
  const pctB = tradesB > 0 ? (winsB / tradesB) * 100 : 0;

  if (aOk && bOk) {
    const aBetter = pctA >= pctB;
    return {
      kind: "both",
      betterLabel: aBetter ? labelA : labelB,
      betterPct: aBetter ? pctA : pctB,
      worseLabel: aBetter ? labelB : labelA,
      worsePct: aBetter ? pctB : pctA,
    };
  }
  if (aOk) return { kind: "single", betterLabel: labelA, betterPct: pctA };
  if (bOk) return { kind: "single", betterLabel: labelB, betterPct: pctB };
  return { kind: "none" };
}

// Runs all "Ask Your Journal" questions in a single Supabase fetch.
// RLS on the trades table means this only ever touches the signed-in user's rows.
export async function getAllAnswers(
  supabase: SupabaseClient,
  timezone: string | null,
): Promise<{ answers: AskAnswer[]; totalTrades: number }> {
  const { data, error } = await supabase
    .from("trades")
    .select(
      "exit_date, dollar_pl, direction, risk_percent, r_multiple, custom_fields, trade_strategies(strategies(name))",
    )
    .eq("status", "closed")
    .not("exit_date", "is", null)
    .order("exit_date", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as {
    exit_date: string;
    dollar_pl: number | null;
    direction: string | null;
    risk_percent: number | null;
    r_multiple: number | null;
    custom_fields: Record<string, unknown>;
    trade_strategies: { strategies: { name: string }[] }[];
  }[];

  const noDataAnswer = (id: string, category: AskAnswer["category"]): AskAnswer => ({
    id,
    category,
    headline: "Not enough data yet.",
    subtext: "Close a few more trades to unlock this insight.",
    noData: true,
  });

  if (rows.length < 3) {
    return { answers: [], totalTrades: rows.length };
  }

  // Single pass over all rows
  let totalWins = 0;
  const byDay = new Map<string, SegmentStats>();
  const byDirection = new Map<string, SegmentStats>();
  const byTag = new Map<string, SegmentStats>();
  const byEmotion = new Map<string, SegmentStats>();
  const lowIntensity: { won: boolean }[] = [];
  const highIntensity: { won: boolean }[] = [];
  const lossEmotions: string[] = [];
  const byRisk = new Map<string, SegmentStats>();
  const chronological: { won: boolean; pl: number }[] = [];

  for (const row of rows) {
    const won = (row.dollar_pl ?? 0) > 0;
    const pl = row.dollar_pl ?? 0;
    const r = row.r_multiple;
    if (won) totalWins++;

    chronological.push({ won, pl });

    const day = getLocalDayName(row.exit_date, timezone);
    addToSegment(byDay, day, won, r, pl);

    if (row.direction) addToSegment(byDirection, row.direction, won, r, pl);

    const strategyNames = row.trade_strategies
      .flatMap((link) => link.strategies)
      .map((s) => s?.name)
      .filter((name): name is string => typeof name === "string" && name.trim() !== "");
    for (const name of strategyNames) {
      addToSegment(byTag, name, won, r, pl);
    }

    const emotions = asStringArray(row.custom_fields?.[EMOTION_BEFORE_KEY]);
    for (const e of emotions) {
      addToSegment(byEmotion, e, won, r, pl);
    }

    const intensity = row.custom_fields?.[EMOTION_INTENSITY_KEY];
    if (typeof intensity === "number") {
      if (intensity <= 5) lowIntensity.push({ won });
      else highIntensity.push({ won });
    }

    if (!won) {
      lossEmotions.push(...emotions);
    }

    if (row.risk_percent != null) {
      const label = row.risk_percent < 1 ? "Under 1% risk" : "1%+ risk";
      addToSegment(byRisk, label, won, r, pl);
    }
  }

  const overallWinRate = totalWins / rows.length;
  const overallPct = fmt(overallWinRate * 100);

  const answers: AskAnswer[] = [];

  // --- PERFORMANCE ---

  // Best day of week
  {
    const dayEntries = Array.from(byDay.entries()).filter(([, s]) => s.trades >= 3);
    if (dayEntries.length === 0) {
      answers.push(noDataAnswer("day-best", "performance"));
    } else {
      const best = dayEntries.reduce((a, b) => winRate(a[1]) >= winRate(b[1]) ? a : b);
      const chart = mapToChart(byDay).sort(
        (a, b) => WEEKDAY_ORDER.indexOf(a.label) - WEEKDAY_ORDER.indexOf(b.label),
      );
      answers.push({
        id: "day-best",
        category: "performance",
        headline: `${best[0]} is your best day — ${fmt(winRate(best[1]) * 100)}% win rate.`,
        subtext: `${best[1].trades} trades on ${best[0]}s vs. ${overallPct}% overall.`,
        chart,
        highlightLabel: best[0],
        noData: false,
      });
    }
  }

  // Worst day of week
  {
    const dayEntries = Array.from(byDay.entries()).filter(([, s]) => s.trades >= 3);
    if (dayEntries.length === 0) {
      answers.push(noDataAnswer("day-worst", "performance"));
    } else {
      const worst = dayEntries.reduce((a, b) => winRate(a[1]) <= winRate(b[1]) ? a : b);
      const chart = mapToChart(byDay).sort(
        (a, b) => WEEKDAY_ORDER.indexOf(a.label) - WEEKDAY_ORDER.indexOf(b.label),
      );
      answers.push({
        id: "day-worst",
        category: "performance",
        headline: `${worst[0]} is your worst day — ${fmt(winRate(worst[1]) * 100)}% win rate.`,
        subtext: `Consider sizing down or skipping trades on ${worst[0]}s.`,
        chart,
        highlightLabel: worst[0],
        noData: false,
      });
    }
  }

  // Best setup tag by avg R
  {
    const tagEntries = Array.from(byTag.entries()).filter(([, s]) => s.rCount >= 3);
    if (tagEntries.length === 0) {
      answers.push(noDataAnswer("tag-r", "performance"));
    } else {
      const best = tagEntries.reduce((a, b) => (avgR(a[1]) ?? -99) >= (avgR(b[1]) ?? -99) ? a : b);
      const chart = tagEntries.map(([label, s]) => ({ label, winRate: winRate(s), trades: s.trades }));
      const bestAvgR = avgR(best[1])!;
      answers.push({
        id: "tag-r",
        category: "performance",
        headline: `Your best strategy is "${best[0]}" — avg ${fmt(bestAvgR, 2)}R per trade.`,
        subtext: `${best[1].trades} trades using it (${best[1].rCount} with R data), ${fmt(winRate(best[1]) * 100)}% win rate.`,
        chart,
        highlightLabel: best[0],
        noData: false,
      });
    }
  }

  // Long vs short win rate
  {
    const longStats = byDirection.get("long") ?? emptySegment();
    const shortStats = byDirection.get("short") ?? emptySegment();
    const cmp = compareTwoSides("long", longStats.trades, longStats.wins, "short", shortStats.trades, shortStats.wins);
    if (cmp.kind === "none") {
      answers.push(noDataAnswer("direction", "performance"));
    } else {
      const headline = cmp.kind === "both"
        ? `You trade ${cmp.betterLabel}s better — ${fmt(cmp.betterPct!)}% vs ${fmt(cmp.worsePct!)}% on ${cmp.worseLabel}s.`
        : `Your ${cmp.betterLabel} win rate is ${fmt(cmp.betterPct!)}%. Log more of the other direction to compare.`;
      const chart = mapToChart(byDirection);
      answers.push({
        id: "direction",
        category: "performance",
        headline,
        subtext: `Based on ${rows.length} closed trades.`,
        chart,
        highlightLabel: cmp.betterLabel,
        noData: false,
      });
    }
  }

  // --- PSYCHOLOGY ---

  // Best emotion before trade by win rate
  {
    const emotionEntries = Array.from(byEmotion.entries()).filter(([, s]) => s.trades >= 3);
    if (emotionEntries.length === 0) {
      answers.push(noDataAnswer("emotion-winrate", "psychology"));
    } else {
      const best = emotionEntries.reduce((a, b) => winRate(a[1]) >= winRate(b[1]) ? a : b);
      const chart = emotionEntries.map(([label, s]) => ({ label, winRate: winRate(s), trades: s.trades }));
      answers.push({
        id: "emotion-winrate",
        category: "psychology",
        headline: `You trade best feeling "${best[0]}" — ${fmt(winRate(best[1]) * 100)}% win rate.`,
        subtext: `vs. ${overallPct}% overall across ${best[1].trades} trades.`,
        chart,
        highlightLabel: best[0],
        noData: false,
      });
    }
  }

  // Emotion intensity ≤5 vs >5
  {
    const lowWins = lowIntensity.filter((t) => t.won).length;
    const highWins = highIntensity.filter((t) => t.won).length;
    const cmp = compareTwoSides(
      "Calm (≤5)", lowIntensity.length, lowWins,
      "Intense (>5)", highIntensity.length, highWins,
    );
    if (cmp.kind === "none") {
      answers.push(noDataAnswer("emotion-intensity", "psychology"));
    } else {
      const headline = cmp.kind === "both"
        ? `${cmp.betterLabel === "Calm (≤5)" ? "Calmer entries (intensity ≤5)" : "High-intensity entries (>5)"} outperform — ${fmt(cmp.betterPct!)}% vs ${fmt(cmp.worsePct!)}% win rate.`
        : `Win rate on ${cmp.betterLabel === "Calm (≤5)" ? "low-intensity (≤5)" : "high-intensity (>5)"} trades: ${fmt(cmp.betterPct!)}%. Log more of the other intensity to compare.`;
      const subtext = cmp.kind === "both"
        ? `${lowIntensity.length} low-intensity trades vs ${highIntensity.length} high-intensity.`
        : `${lowIntensity.length + highIntensity.length} trades logged with intensity so far.`;
      const chart = [
        lowIntensity.length >= MIN_SAMPLE_SIZE
          ? { label: "Calm (≤5)", winRate: lowIntensity.length > 0 ? lowWins / lowIntensity.length : 0, trades: lowIntensity.length }
          : null,
        highIntensity.length >= MIN_SAMPLE_SIZE
          ? { label: "Intense (>5)", winRate: highIntensity.length > 0 ? highWins / highIntensity.length : 0, trades: highIntensity.length }
          : null,
      ].filter(Boolean) as { label: string; winRate: number; trades: number }[];
      answers.push({
        id: "emotion-intensity",
        category: "psychology",
        headline,
        subtext,
        chart,
        highlightLabel: cmp.betterLabel,
        noData: false,
      });
    }
  }

  // Most common emotion on losing trades
  {
    if (lossEmotions.length === 0) {
      answers.push(noDataAnswer("emotion-losses", "psychology"));
    } else {
      const freq = new Map<string, number>();
      for (const e of lossEmotions) freq.set(e, (freq.get(e) ?? 0) + 1);
      const top = Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0];
      const totalLosses = chronological.filter((t) => !t.won).length;
      answers.push({
        id: "emotion-losses",
        category: "psychology",
        headline: `"${top[0]}" is your most common emotion before losses.`,
        subtext: `Appeared before ${top[1]} of your ${totalLosses} losing trades. Take that as a signal.`,
        noData: false,
      });
    }
  }

  // --- RISK ---

  // Risk % < 1 vs >= 1
  {
    const low = byRisk.get("Under 1% risk") ?? emptySegment();
    const high = byRisk.get("1%+ risk") ?? emptySegment();
    const cmp = compareTwoSides("Under 1% risk", low.trades, low.wins, "1%+ risk", high.trades, high.wins);
    if (cmp.kind === "none") {
      answers.push(noDataAnswer("risk-percent", "risk"));
    } else {
      const headline = cmp.kind === "both"
        ? `${cmp.betterLabel === "Under 1% risk" ? "Smaller risk (under 1%)" : "Larger risk (1%+)"} performs better — ${fmt(cmp.betterPct!)}% vs ${fmt(cmp.worsePct!)}% win rate.`
        : `Win rate on ${cmp.betterLabel === "Under 1% risk" ? "under-1%-risk" : "1%+ risk"} trades: ${fmt(cmp.betterPct!)}%. Log more of the other risk band to compare.`;
      const subtext = cmp.kind === "both"
        ? `${low.trades} small-risk trades vs ${high.trades} larger-risk trades.`
        : `${low.trades + high.trades} risk-sized trades logged so far.`;
      const chart = mapToChart(byRisk);
      answers.push({
        id: "risk-percent",
        category: "risk",
        headline,
        subtext,
        chart,
        highlightLabel: cmp.betterLabel,
        noData: false,
      });
    }
  }

  // --- STREAKS ---

  // Average P/L in the 3 trades following a 2+ loss streak
  {
    if (chronological.length < 5) {
      answers.push(noDataAnswer("post-loss-streak", "streaks"));
    } else {
      const postStreakPLs: number[] = [];
      let lossRun = 0;
      for (let i = 0; i < chronological.length; i++) {
        if (!chronological[i].won) {
          lossRun++;
        } else {
          if (lossRun >= 2) {
            // collect up to 3 trades strictly after the win that ended the streak
            for (let j = i + 1; j < Math.min(i + 4, chronological.length); j++) {
              postStreakPLs.push(chronological[j].pl);
            }
          }
          lossRun = 0;
        }
      }

      if (postStreakPLs.length === 0) {
        answers.push({
          id: "post-loss-streak",
          category: "streaks",
          headline: "No 2+ loss streaks found yet.",
          subtext: "This insight appears once you've had at least one losing streak of 2 or more in a row.",
          noData: false,
        });
      } else {
        const avgPL = postStreakPLs.reduce((a, b) => a + b, 0) / postStreakPLs.length;
        const positive = avgPL >= 0;
        answers.push({
          id: "post-loss-streak",
          category: "streaks",
          headline: positive
            ? `You bounce back well after losing streaks — avg $${fmt(avgPL, 2)} in the next 3 trades.`
            : `Watch out after losing streaks — avg $${fmt(avgPL, 2)} in the next 3 trades.`,
          subtext: `Based on ${postStreakPLs.length} trades following a 2+ loss streak.`,
          noData: false,
        });
      }
    }
  }

  return { answers, totalTrades: rows.length };
}
