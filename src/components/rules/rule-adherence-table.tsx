import Link from "next/link";
import { formatMoney } from "@/lib/format/money";
import type { PeriodAdherence } from "@/lib/overall-rules/month";

// A period's overall-rule adherence (src/lib/overall-rules/month.ts). Plain
// markup with no hooks, so the server-rendered Strategies page and the
// client-side report view both use it. Every figure comes from the app's own
// checks; text rules are listed as judged by the AI review, with no number.

export function RuleAdherenceTable({ adherence, compact = false }: { adherence: PeriodAdherence; compact?: boolean }) {
  const { rules, tradesJudged, tradesClean, textRules } = adherence;
  if (rules.length === 0 && textRules.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {tradesJudged === 0 ? (
        <p className="text-sm text-zinc-500">No closed trades were checked against your rules in this period.</p>
      ) : (
        <p className="text-sm text-zinc-700 dark:text-zinc-300 print:text-black">
          {tradesClean} of {tradesJudged} trade{tradesJudged === 1 ? "" : "s"} kept every rule that applied
          <span className="text-zinc-500"> ({Math.round((tradesClean / tradesJudged) * 100)}%)</span>
        </p>
      )}
      {rules.length > 0 && tradesJudged > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                <th className="py-1.5 text-left font-medium">Rule</th>
                <th className="py-1.5 text-right font-medium">Kept</th>
                {!compact && <th className="py-1.5 text-right font-medium">Avg P/L kept / broken</th>}
                <th className="py-1.5 text-right font-medium">Cost of breaking</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((m) => (
                <tr key={m.rule.id} className="border-t border-zinc-100 align-top dark:border-subtle">
                  <td className="py-2 pr-3 text-zinc-800 dark:text-zinc-200 print:text-black">
                    <span className="break-words">{m.rule.label}</span>
                    {m.notTriggered + m.unevaluable > 0 && (
                      <span className="block text-xs text-zinc-500">
                        {m.notTriggered > 0 ? `didn't come up on ${m.notTriggered}` : ""}
                        {m.notTriggered > 0 && m.unevaluable > 0 ? " · " : ""}
                        {m.unevaluable > 0 ? `couldn't check ${m.unevaluable}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="tnum py-2 text-right font-mono text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                    {m.adherence === null ? "—" : `${m.followed}/${m.followed + m.broken} (${Math.round(m.adherence * 100)}%)`}
                  </td>
                  {!compact && (
                    <td className="tnum py-2 text-right font-mono text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                      {formatMoney(m.followedAvgPl, { sign: "always" })} / {formatMoney(m.brokenAvgPl, { sign: "always" })}
                    </td>
                  )}
                  <td
                    className={`tnum py-2 text-right font-mono whitespace-nowrap ${
                      m.brokenCost == null ? "text-zinc-400" : m.brokenCost > 0 ? "text-loss" : "text-profit"
                    }`}
                    title={m.brokenCost == null ? "Only exit rules have a cost: selling on time vs what you got." : undefined}
                  >
                    {m.brokenCost == null ? "—" : formatMoney(-m.brokenCost, { sign: "always" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rules.some((m) => m.brokenTrades.length > 0) && !compact && (
        <ul className="flex flex-col gap-1 text-xs text-zinc-500">
          {rules.flatMap((m) =>
            m.brokenTrades.slice(0, 5).map((b) => (
              <li key={`${m.rule.id}-${b.tradeId}`}>
                <Link href={`/trades/${b.tradeId}`} className="font-mono text-zinc-700 hover:text-primary dark:text-zinc-300">
                  {b.ticker || "Trade"}
                </Link>{" "}
                broke &quot;{m.rule.label}&quot;: {b.summary}
              </li>
            )),
          )}
        </ul>
      )}
      {textRules.length > 0 && (
        <p className="text-xs text-zinc-500">
          {textRules.length} rule{textRules.length === 1 ? "" : "s"} written in words {textRules.length === 1 ? "is" : "are"} judged by
          the AI monthly review, not counted here.
        </p>
      )}
    </div>
  );
}
