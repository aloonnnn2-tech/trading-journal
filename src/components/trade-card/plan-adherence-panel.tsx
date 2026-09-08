import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { OPERATOR_LABELS } from "@/lib/plan-rules/subjects";
import type { RuleEvaluation, StrategyAdherence } from "@/lib/plan-rules/types";

// Plan adherence for one trade, one block per tagged strategy.
//
// A server component with no interactivity: the whole result is a pure
// function of data the page already loaded, so there is nothing to fetch, no
// state to hold, and no reason to ship it to the browser.

/** Renders the comparison the rule expresses, e.g. "is at most 1". */
function ruleCondition(evaluation: RuleEvaluation): string {
  const { rule } = evaluation;
  const operator = OPERATOR_LABELS[rule.operator];

  if (rule.operator === "between") {
    return `${operator} ${rule.number_value} and ${rule.number_value_max}`;
  }
  if (rule.number_value !== null) return `${operator} ${rule.number_value}`;
  if (rule.text_value) return `${operator} "${rule.text_value}"`;
  return operator;
}

const OUTCOME_MARK = {
  pass: { symbol: "✓", className: "text-profit" },
  fail: { symbol: "✕", className: "text-loss" },
  // Not a cross. An unevaluable rule was not broken -- marking it like a
  // failure would be the single most misleading thing this panel could do.
  unevaluable: { symbol: "–", className: "text-zinc-400 dark:text-zinc-600" },
} as const;

function AdherenceBlock({ adherence }: { adherence: StrategyAdherence }) {
  const checked = adherence.passed + adherence.failed;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {adherence.strategyName}
        </h3>
        <span className="font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
          {adherence.score === null ? (
            // "—", never 0%. Nothing could be checked, which is not the same
            // as everything having failed.
            <span className="text-zinc-400 dark:text-zinc-600">No rules could be checked</span>
          ) : (
            <>
              Plan adherence: {adherence.passed}/{checked}
              <span className="ml-1.5 text-zinc-400">
                ({Math.round(adherence.score * 100)}%)
              </span>
            </>
          )}
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {adherence.evaluations.map((evaluation) => {
          const mark = OUTCOME_MARK[evaluation.outcome];
          return (
            <li key={evaluation.rule.id} className="flex items-start gap-2 text-sm">
              <span className={`mt-0.5 w-3 shrink-0 font-mono ${mark.className}`}>
                {mark.symbol}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-zinc-800 dark:text-zinc-200">{evaluation.rule.label}</span>
                <span className="ml-2 text-xs text-zinc-500">{ruleCondition(evaluation)}</span>
                {evaluation.actual !== null && (
                  <span className="ml-2 font-mono text-xs text-zinc-500">
                   . Was {evaluation.actual}
                  </span>
                )}
                {evaluation.reason && (
                  <span className="ml-2 text-xs italic text-zinc-500">{evaluation.reason}</span>
                )}
                {evaluation.caveat && (
                  <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">
                    {evaluation.caveat}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {adherence.unevaluable > 0 && (
        // Stated plainly rather than folded into the score. The trader should
        // know the score covers fewer rules than they wrote, and why.
        <p className="text-xs text-zinc-500">
          {adherence.unevaluable} rule{adherence.unevaluable === 1 ? "" : "s"} couldn&apos;t be
          checked and {adherence.unevaluable === 1 ? "is" : "are"} excluded from the score.
          Filling in the missing fields would include {adherence.unevaluable === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}

export function PlanAdherencePanel({
  adherences,
  hasStrategies,
}: {
  adherences: StrategyAdherence[];
  /** Whether the trade is tagged with any strategy at all -- which is a
   *  different empty state from "tagged, but that strategy has no rules". */
  hasStrategies: boolean;
}) {
  return (
    <Card standalone={false} className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        Plan Adherence
      </h2>

      {adherences.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {hasStrategies ? (
            <>
              This trade&apos;s strategy has no rules yet. Add measurable rules on the{" "}
              <Link href="/strategies" className="text-primary hover:underline">
                Strategies page
              </Link>{" "}
              and every trade using it will be scored against them.
            </>
          ) : (
            <>
              Tag this trade with a strategy to score it against that strategy&apos;s rules.
            </>
          )}
        </p>
      ) : (
        adherences.map((adherence) => (
          <AdherenceBlock key={adherence.strategyId} adherence={adherence} />
        ))
      )}
    </Card>
  );
}
