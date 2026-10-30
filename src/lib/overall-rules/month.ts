import type { Trade } from "@/lib/trades/types";
import type { OverallRule, RuleCheck } from "./types";

// A period's overall-rule adherence, from each trade's checks. Pure; shared
// by the month-end report (free) and the AI period review (paid), so both
// always show the same numbers.

export type PeriodTrade = Pick<Trade, "id" | "ticker" | "direction" | "exit_date" | "entry_date" | "dollar_pl" | "r_multiple">;

export interface BrokenTrade {
  tradeId: string;
  ticker: string;
  date: string | null;
  summary: string;
  cost: number | null;
}

export interface RuleMonth {
  rule: OverallRule;
  followed: number;
  broken: number;
  notTriggered: number;
  unevaluable: number;
  /** followed / (followed + broken); null when it never applied. */
  adherence: number | null;
  /** Mean P&L and R of the trades that kept / broke it. */
  followedAvgPl: number | null;
  brokenAvgPl: number | null;
  followedAvgR: number | null;
  brokenAvgR: number | null;
  /** Sum of the broken trades' cost (moving-average exits only), when known. */
  brokenCost: number | null;
  brokenTrades: BrokenTrade[];
}

export interface PeriodAdherence {
  rules: RuleMonth[];
  /** Trades where at least one rule could be judged. */
  tradesJudged: number;
  /** Of those, trades that broke none. */
  tradesClean: number;
  /** Text rules: judged only by the AI. */
  textRules: OverallRule[];
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function periodAdherence(
  rules: OverallRule[],
  trades: { trade: PeriodTrade; checks: RuleCheck[] }[],
): PeriodAdherence {
  const enabled = rules.filter((r) => r.enabled);
  const judgedRules = enabled.filter((r) => r.kind !== "text");
  let tradesJudged = 0;
  let tradesClean = 0;
  for (const { checks } of trades) {
    const judged = checks.filter((c) => c.outcome === "followed" || c.outcome === "broken");
    if (judged.length === 0) continue;
    tradesJudged += 1;
    if (!judged.some((c) => c.outcome === "broken")) tradesClean += 1;
  }

  const ruleMonths = judgedRules.map((rule): RuleMonth => {
    const rows = trades
      .map(({ trade, checks }) => ({ trade, check: checks.find((c) => c.rule.id === rule.id) }))
      .filter((r): r is { trade: PeriodTrade; check: RuleCheck } => r.check != null);
    const kept = rows.filter((r) => r.check.outcome === "followed");
    const broke = rows.filter((r) => r.check.outcome === "broken");
    const pl = (list: typeof rows) => mean(list.map((r) => r.trade.dollar_pl).filter((v): v is number => v != null));
    const r = (list: typeof rows) => mean(list.map((x) => x.trade.r_multiple).filter((v): v is number => v != null));
    const costs = broke.map((b) => b.check.detail.cost).filter((c): c is number => c != null);
    return {
      rule,
      followed: kept.length,
      broken: broke.length,
      notTriggered: rows.filter((x) => x.check.outcome === "not_triggered").length,
      unevaluable: rows.filter((x) => x.check.outcome === "unevaluable").length,
      adherence: kept.length + broke.length === 0 ? null : kept.length / (kept.length + broke.length),
      followedAvgPl: pl(kept),
      brokenAvgPl: pl(broke),
      followedAvgR: r(kept),
      brokenAvgR: r(broke),
      brokenCost: costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0),
      brokenTrades: broke.map((b) => ({
        tradeId: b.trade.id,
        ticker: b.trade.ticker,
        date: (b.trade.exit_date ?? b.trade.entry_date)?.slice(0, 10) ?? null,
        summary: b.check.detail.summary,
        cost: b.check.detail.cost ?? null,
      })),
    };
  });

  return { rules: ruleMonths, tradesJudged, tradesClean, textRules: enabled.filter((r) => r.kind === "text") };
}

/** The prompt section for the AI period review, capped to fit its budget. */
export function describePeriodAdherence(adherence: PeriodAdherence, maxChars = 2_400): string[] {
  const lines: string[] = [];
  if (adherence.rules.length === 0 && adherence.textRules.length === 0) return lines;
  const money = (n: number | null) => (n == null ? "n/a" : `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`);
  const pct = (n: number | null) => (n == null ? "n/a" : `${Math.round(n * 100)}%`);
  const r = (n: number | null) => (n == null ? "n/a" : `${n.toFixed(2)}R`);

  lines.push(
    `Trades judged against at least one rule: ${adherence.tradesJudged}; broke none: ${adherence.tradesClean}` +
      (adherence.tradesJudged > 0 ? ` (${pct(adherence.tradesClean / adherence.tradesJudged)})` : ""),
  );
  for (const m of adherence.rules) {
    lines.push(
      `- "${clean(m.rule.label)}": followed ${m.followed}, broken ${m.broken}, not triggered ${m.notTriggered}, couldn't check ${m.unevaluable}; adherence ${pct(m.adherence)}` +
        (m.followed > 0 || m.broken > 0
          ? `; avg P&L when followed ${money(m.followedAvgPl)} (${r(m.followedAvgR)}), when broken ${money(m.brokenAvgPl)} (${r(m.brokenAvgR)})`
          : "") +
        (m.brokenCost != null ? `; cost of breaking it ${money(m.brokenCost)} (positive = lost by not following)` : ""),
    );
  }
  const broken = adherence.rules.flatMap((m) => m.brokenTrades.map((b) => ({ rule: m.rule.label, ...b })));
  if (broken.length > 0) {
    lines.push("Broken, trade by trade:");
    let used = lines.join("\n").length;
    let shown = 0;
    for (const b of broken) {
      const line = `  - ${b.date ?? "?"} ${b.ticker} broke "${clean(b.rule)}": ${clean(b.summary)}`;
      if (used + line.length > maxChars) break;
      lines.push(line);
      used += line.length + 1;
      shown += 1;
    }
    if (shown < broken.length) lines.push(`  (${broken.length - shown} more not listed)`);
  }
  if (adherence.textRules.length > 0) {
    lines.push("Rules in words (no app result -- judge these yourself from the trade log and notes, and say how sure you are):");
    for (const rule of adherence.textRules) lines.push(`- "${clean(rule.label)}"`);
  }
  return lines;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
