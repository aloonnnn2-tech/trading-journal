"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Info, TrendingDown, TrendingUp } from "lucide-react";
import { AnswerText } from "@/app/ask/answer-text";
import { PROVIDER_LABELS } from "@/lib/ai-keys/types";
import type { ConfidenceLevel, PeriodReviewContent } from "@/lib/ai-reviews/schema";
import type { StoredReview } from "@/lib/ai-reviews/types";
import { formatDate } from "@/lib/dates/format";

// Renders a validated period review. Same contract as the trade review card:
// content has already passed periodReviewContentSchema, so nothing here
// defends against a missing field or a wrong type, and prose goes through
// AnswerText rather than being interpolated raw.

/** Spec asks for "3 or fewer" priorities. Enforced at render for the same
 *  reason as the trade card's action items: rejecting an otherwise good
 *  review over a presentational count would cost a second provider call. */
const MAX_PRIORITIES = 3;

const CONFIDENCE_STYLES: Record<ConfidenceLevel, { label: string; className: string }> = {
  high: { label: "High confidence", className: "border-profit/40 bg-profit/10 text-profit" },
  medium: {
    label: "Medium confidence",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  low: {
    label: "Low confidence",
    className: "border-zinc-300 bg-zinc-500/10 text-zinc-500 dark:border-zinc-700",
  },
  // Deliberately the loudest of the four. This is the badge that stops a
  // finding from a four-trade week being read as a result.
  insufficient_data: {
    label: "Not enough data",
    className: "border-loss/40 bg-loss/10 text-loss",
  },
};

function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const style = CONFIDENCE_STYLES[level];
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${style.className}`}
    >
      {style.label}
    </span>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t border-zinc-200 pt-3 dark:border-subtle">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        {icon}
        {title}
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`}
          strokeWidth={2}
        />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function Bullets({ items, marker }: { items: string[]; marker: string }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <span className="select-none text-zinc-400">{marker}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Edge and leak share a shape, and pairing them side by side is the point:
 *  "what's working" is only actionable next to "what's costing you". */
function FindingCard({
  label,
  icon,
  value,
  tone,
}: {
  label: string;
  icon: ReactNode;
  value: PeriodReviewContent["biggest_edge"];
  tone: "good" | "bad";
}) {
  const className = tone === "good" ? "border-profit/30 bg-profit/5" : "border-loss/30 bg-loss/5";
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          {icon}
          {label}
        </p>
        <ConfidenceBadge level={value.confidence} />
      </div>
      <p className="mt-1.5 text-sm text-zinc-800 dark:text-zinc-200">
        {value.finding || "Nothing in this period's data supports one."}
      </p>
      {value.evidence && <p className="mt-1 text-xs text-zinc-500">{value.evidence}</p>}
    </div>
  );
}

export function PeriodReviewCard({
  review,
  stale,
  actions,
}: {
  review: StoredReview<PeriodReviewContent>;
  stale: boolean;
  actions?: ReactNode;
}) {
  const c = review.content;
  const priorities = c.priorities.slice(0, MAX_PRIORITIES);

  return (
    <div className="flex flex-col gap-3">
      {stale && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          The trades in this period have changed since the review was generated. One was
          edited, added or removed. Regenerate for an up-to-date analysis.
        </div>
      )}

      <div>
        <AnswerText text={c.performance_summary} />
        <p className="mt-1.5 text-[11px] text-zinc-500">
          Covers {review.trades_analyzed} closed trade{review.trades_analyzed === 1 ? "" : "s"} in{" "}
          {review.period_start} to {review.period_end}.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <FindingCard
          label="Biggest edge"
          icon={<TrendingUp className="h-3.5 w-3.5 text-profit" strokeWidth={2} />}
          value={c.biggest_edge}
          tone="good"
        />
        <FindingCard
          label="Biggest leak"
          icon={<TrendingDown className="h-3.5 w-3.5 text-loss" strokeWidth={2} />}
          value={c.biggest_leak}
          tone="bad"
        />
      </div>

      {c.what_went_well.length > 0 && (
        <Section title="What went well">
          <Bullets items={c.what_went_well} marker="+" />
        </Section>
      )}

      {c.what_went_wrong.length > 0 && (
        <Section title="What went wrong">
          <Bullets items={c.what_went_wrong} marker="−" />
        </Section>
      )}

      {c.behavioral_patterns.length > 0 && (
        <Section title="Behavioural patterns">
          <ul className="flex flex-col gap-2.5">
            {c.behavioral_patterns.map((p, i) => (
              <li key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {p.pattern}
                  </span>
                  <ConfidenceBadge level={p.confidence} />
                </div>
                {p.evidence && <p className="mt-0.5 text-xs text-zinc-500">{p.evidence}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {c.strategy_breakdown.length > 0 && (
        <Section title="Strategy breakdown">
          <ul className="flex flex-col gap-2.5">
            {c.strategy_breakdown.map((s, i) => (
              <li key={i}>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{s.strategy}</p>
                {s.verdict && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.verdict}</p>
                )}
                {/* The sample caveat sits with the strategy it qualifies,
                    not in a footnote nobody reads. */}
                {s.sample_note && <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{s.sample_note}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {c.risk_review.length > 0 && (
        <Section title="Risk management">
          <Bullets items={c.risk_review} marker="•" />
        </Section>
      )}

      {c.period_comparison && (
        <Section title="Versus the previous period">
          <AnswerText text={c.period_comparison} />
        </Section>
      )}

      {c.missing_information.length > 0 && (
        <Section
          title="Not recorded in this period"
          icon={<Info className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2} />}
        >
          <Bullets items={c.missing_information} marker="?" />
        </Section>
      )}

      {priorities.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
            Next period
          </p>
          <ol className="mt-1.5 ml-4 flex list-decimal flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-200">
            {priorities.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-200 pt-3 text-[11px] text-zinc-500 dark:border-subtle">
        <span className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" strokeWidth={2} />
          Generated by {PROVIDER_LABELS[review.provider]} ({review.model}) on{" "}
          {formatDate(review.created_at)}, not financial advice.
        </span>
        {actions && <span className="ml-auto flex items-center gap-3">{actions}</span>}
      </div>
    </div>
  );
}
