"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Info, ThumbsUp, Wrench } from "lucide-react";
import { AnswerText } from "@/app/ask/answer-text";
import { PROVIDER_LABELS } from "@/lib/ai-keys/types";
import type { RuleStatus, TradeReviewContent } from "@/lib/ai-reviews/schema";
import type { StoredReview } from "@/lib/ai-reviews/types";
import { formatDate } from "@/lib/dates/format";

// Renders a validated trade review.
//
// Everything here is driven by data that has already been through
// tradeReviewContentSchema, so this component does no defending of its own --
// no "if it's a string", no clamping. That is the point of validating at the
// boundary.
//
// Prose still goes through AnswerText rather than being interpolated raw:
// it builds React elements from strings and never touches
// dangerouslySetInnerHTML, so provider output -- untrusted text that has just
// round-tripped through a third party -- has no path to injecting markup.

/** Spec asks for 1-3 next actions. A model that returns more has not produced
 *  an invalid review, so the limit is applied here rather than by rejecting
 *  the reply and paying for a second provider call. */
const MAX_ACTION_ITEMS = 3;

const BREAKDOWN_LABELS: [keyof TradeReviewContent["score_breakdown"], string][] = [
  ["setup_quality", "Setup"],
  ["entry_quality", "Entry"],
  ["risk_management", "Risk"],
  ["exit_management", "Exit"],
  ["plan_adherence", "Plan"],
  ["emotional_discipline", "Discipline"],
];

const RULE_STATUS_STYLES: Record<RuleStatus, { label: string; className: string }> = {
  followed: { label: "Followed", className: "border-profit/40 bg-profit/10 text-profit" },
  partially_followed: {
    label: "Partial",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  not_followed: { label: "Not followed", className: "border-loss/40 bg-loss/10 text-loss" },
  unknown: {
    label: "Unknown",
    className: "border-zinc-300 bg-zinc-500/10 text-zinc-500 dark:border-zinc-700",
  },
};

/** Score bands. Deliberately generous at the bottom: this scores decisions,
 *  and a trade that followed a plan into a loss should not read as a failure. */
function scoreTone(score: number): string {
  if (score >= 70) return "text-profit";
  if (score >= 45) return "text-amber-600 dark:text-amber-400";
  return "text-loss";
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

function Callout({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone: "good" | "bad";
}) {
  const className =
    tone === "good" ? "border-profit/30 bg-profit/5" : "border-loss/30 bg-loss/5";
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${className}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">{text}</p>
    </div>
  );
}

export function TradeReviewCard({
  review,
  stale,
  actions,
}: {
  review: StoredReview<TradeReviewContent>;
  stale: boolean;
  /** Regenerate / copy / delete. Owned by the panel, which holds the keys and
   *  the request state; this component only has to place them. */
  actions?: ReactNode;
}) {
  const c = review.content;
  const breakdown = BREAKDOWN_LABELS.map(([key, label]) => ({
    label,
    value: c.score_breakdown[key] ?? null,
  }));
  const actionItems = c.action_items.slice(0, MAX_ACTION_ITEMS);

  return (
    <div className="flex flex-col gap-3">
      {stale && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          This trade has been edited since the review was generated, so some figures it
          quotes may no longer match. Regenerate for an up-to-date analysis.
        </div>
      )}

      {/* Headline: the verdict and the score, together, because the score
          means nothing without the sentence explaining it. */}
      <div className="flex items-start gap-4">
        <div className="shrink-0 text-center">
          <p className={`text-3xl font-semibold tabular-nums ${scoreTone(c.score)}`}>{c.score}</p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">/ 100</p>
        </div>
        <div className="min-w-0 flex-1">
          <AnswerText text={c.overall_assessment} />
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Scores execution, not profit. A winning trade can still score poorly.
          </p>
        </div>
      </div>

      {breakdown.some((b) => b.value !== null) && (
        <Section title="Score breakdown">
          <div className="grid gap-2 sm:grid-cols-2">
            {breakdown.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-zinc-500">{b.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  {b.value !== null && (
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${b.value}%` }}
                    />
                  )}
                </div>
                {/* An em dash, not a zero: the model declined to score this,
                    which is not the same as scoring it nothing. */}
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                  {b.value ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(c.biggest_mistake || c.best_decision) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {c.best_decision && (
            <Callout label="Best decision" text={c.best_decision} tone="good" />
          )}
          {c.biggest_mistake && (
            <Callout label="Biggest mistake" text={c.biggest_mistake} tone="bad" />
          )}
        </div>
      )}

      {c.what_went_well.length > 0 && (
        <Section
          title="What you did well"
          icon={<ThumbsUp className="h-3.5 w-3.5 text-profit" strokeWidth={2} />}
        >
          <Bullets items={c.what_went_well} marker="+" />
        </Section>
      )}

      {c.what_could_improve.length > 0 && (
        <Section
          title="What could be improved"
          icon={<Wrench className="h-3.5 w-3.5 text-amber-500" strokeWidth={2} />}
        >
          <Bullets items={c.what_could_improve} marker="−" />
        </Section>
      )}

      {c.rule_adherence.length > 0 && (
        <Section title="Rule adherence">
          <ul className="flex flex-col gap-2">
            {c.rule_adherence.map((entry, i) => {
              const style = RULE_STATUS_STYLES[entry.status];
              return (
                <li key={i} className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${style.className}`}
                  >
                    {style.label}
                  </span>
                  <span className="text-sm text-zinc-800 dark:text-zinc-200">{entry.rule}</span>
                  {entry.note && <span className="text-sm text-zinc-500">— {entry.note}</span>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {c.emotional_analysis.length > 0 && (
        <Section title="Emotional analysis">
          <Bullets items={c.emotional_analysis} marker="•" />
        </Section>
      )}

      {c.missing_information.length > 0 && (
        <Section
          title="Not recorded on this trade"
          icon={<Info className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2} />}
        >
          <p className="mb-2 text-xs text-zinc-500">
            The review couldn&apos;t judge these because the journal didn&apos;t have them.
          </p>
          <Bullets items={c.missing_information} marker="?" />
        </Section>
      )}

      {actionItems.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
            Next trade
          </p>
          <ol className="mt-1.5 ml-4 flex list-decimal flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-200">
            {actionItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-200 pt-3 text-[11px] text-zinc-500 dark:border-subtle">
        {/* Which model wrote this is part of reading it: the same journal
            through a small free-tier model and a frontier one are not
            interchangeable artifacts. */}
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
