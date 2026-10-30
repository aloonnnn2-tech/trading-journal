import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { tally } from "@/lib/overall-rules/evaluate";
import type { CheckOutcome, RuleCheck } from "@/lib/overall-rules/types";

// The trade against the user's overall rules (0081). A server component: the
// page has already worked everything out (src/lib/overall-rules/load.ts).
//
// Like plan adherence, "couldn't check" and "not triggered" are never shown
// as failures: only ✕ means the rule applied and was broken.

const MARK: Record<CheckOutcome, { symbol: string; className: string; label: string }> = {
  followed: { symbol: "✓", className: "text-profit", label: "Followed" },
  broken: { symbol: "✕", className: "text-loss", label: "Broken" },
  not_triggered: { symbol: "–", className: "text-zinc-400 dark:text-zinc-600", label: "Didn't come up" },
  unevaluable: { symbol: "?", className: "text-zinc-400 dark:text-zinc-600", label: "Couldn't check" },
  ai: { symbol: "AI", className: "text-[10px] text-zinc-500", label: "Judged in the AI review" },
};

export function OverallRulesPanel({
  checks,
  hasRules,
  ready,
}: {
  checks: RuleCheck[];
  hasRules: boolean;
  ready: boolean;
}) {
  if (!ready) return null;
  const t = tally(checks);

  return (
    <Card standalone={false} data-shot="overall-rules" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Your rules</h2>
        {t.score !== null && (
          <span className="font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
            Kept {t.followed}/{t.followed + t.broken}
            <span className="ml-1.5 text-zinc-400">({Math.round(t.score * 100)}%)</span>
          </span>
        )}
      </div>

      {!hasRules ? (
        <p className="text-sm text-zinc-500">
          Write down the rules you trade by on the{" "}
          <Link href="/strategies" className="text-primary hover:underline">
            Strategies page
          </Link>{" "}
          (for example &quot;exit when the close drops below the SMA 150&quot;) and every trade shows whether you kept them.
        </p>
      ) : checks.length === 0 ? (
        <p className="text-sm text-zinc-500">None of your rules apply to this trade.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {checks.map((check) => {
            const mark = MARK[check.outcome];
            return (
              <li key={check.rule.id} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-0.5 w-4 shrink-0 text-center font-mono ${mark.className}`}
                  title={mark.label}
                  aria-label={mark.label}
                >
                  {mark.symbol}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="break-words text-zinc-800 dark:text-zinc-200">{check.rule.label}</span>
                  <span className="mt-0.5 block text-xs text-zinc-500">{check.detail.summary}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {t.unevaluable > 0 && (
        <p className="text-xs text-zinc-500">
          Rules that couldn&apos;t be checked, or didn&apos;t come up on this trade, don&apos;t count against you.
        </p>
      )}
    </Card>
  );
}
