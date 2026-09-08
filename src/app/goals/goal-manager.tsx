"use client";

import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import {
  METRIC_LABELS,
  METRIC_UNITS,
  type Goal,
  type GoalKind,
  type GoalMetric,
  type GoalPeriod,
  type GoalProgress,
} from "@/lib/goals/evaluate";
import { CORE_SUBJECTS, OPERATOR_LABELS } from "@/lib/plan-rules/subjects";

// Goals: set a measurable commitment, then see whether you kept it.
//
// **The editor only offers conditions the app can actually count.** There is
// no free-text goal with a slider, because a progress bar the trader moves by
// hand measures nothing -- and the brief is explicit that subjective goals
// must not become fake numerical scores. Anything not expressible here is
// something this app cannot honestly track, and saying so is the correct
// answer.

const KIND_LABELS: Record<GoalKind, string> = {
  adherence: "Follow a rule on a % of trades",
  aggregate: "Hit a number",
  reduction: "Make a mistake fewer times",
};

const PERIOD_LABELS: Record<GoalPeriod, string> = {
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  all_time: "All time",
};

/** Numeric core fields make sense as goal conditions; text ones ("ticker is
 *  NVDA") describe a filter rather than a discipline. */
const GOAL_SUBJECTS = CORE_SUBJECTS.filter((s) => s.type === "number");

const inputClass =
  "rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

function formatValue(progress: GoalProgress): string {
  const { goal, current } = progress;
  if (current === null) return "—";

  if (goal.kind === "adherence") return `${current.toFixed(0)}%`;
  if (goal.kind === "reduction") return String(Math.round(current));

  const unit = goal.metric ? METRIC_UNITS[goal.metric] : "count";
  if (unit === "percent") return `${current.toFixed(0)}%`;
  if (unit === "r") return `${current >= 0 ? "+" : ""}${current.toFixed(2)}R`;
  return String(Math.round(current));
}

function formatTarget(goal: Goal): string {
  const direction = goal.target_direction === "at_least" ? "at least" : "at most";
  if (goal.kind === "adherence") return `${direction} ${goal.target}% of trades`;
  if (goal.kind === "reduction") return `${direction} ${goal.target}`;

  const unit = goal.metric ? METRIC_UNITS[goal.metric] : "count";
  if (unit === "percent") return `${direction} ${goal.target}%`;
  if (unit === "r") return `${direction} ${goal.target}R`;
  return `${direction} ${goal.target}`;
}

function ProgressRow({
  progress,
  onDelete,
}: {
  progress: GoalProgress;
  onDelete: (goal: Goal) => void;
}) {
  const { goal, fraction, met, reason } = progress;

  return (
    <div className="border-t border-zinc-200 py-3 first:border-t-0 first:pt-0 dark:border-subtle">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{goal.label}</span>
          <span className="ml-2 text-xs text-zinc-500">
            {formatTarget(goal)} · {progress.periodLabel}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`font-mono text-sm ${
              met === null ? "text-zinc-400" : met ? "text-profit" : "text-zinc-900 dark:text-zinc-100"
            }`}
          >
            {formatValue(progress)}
          </span>
          <button
            onClick={() => onDelete(goal)}
            title="Delete goal"
            className="text-red-400 hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {fraction === null ? (
        // No bar at all rather than an empty one: an empty bar reads as "no
        // progress", which is a different claim from "nothing to measure".
        <p className="mt-1 text-xs text-zinc-500">{reason}</p>
      ) : (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className={`h-full rounded-full ${met ? "bg-profit" : "bg-primary"}`}
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {met ? "Met" : "Not yet"} · based on {progress.sample} trade
            {progress.sample === 1 ? "" : "s"}
            {goal.kind === "adherence" && " that recorded this value"}
          </p>
        </>
      )}
    </div>
  );
}

export function GoalManager({
  initialProgress,
  mistakeLabels,
}: {
  initialProgress: GoalProgress[];
  /** Labels the mistake tracker actually produces, so a reduction goal can
   *  only target something that can be counted. */
  mistakeLabels: string[];
}) {
  const [progress, setProgress] = useState(initialProgress);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [kind, setKind] = useState<GoalKind>("aggregate");
  const [label, setLabel] = useState("");
  const [metric, setMetric] = useState<GoalMetric>("trade_count");
  const [subjectKey, setSubjectKey] = useState(GOAL_SUBJECTS[0]?.key ?? "risk_percent");
  const [operator, setOperator] = useState<"lte" | "gte">("lte");
  const [conditionValue, setConditionValue] = useState("1");
  const [mistakeLabel, setMistakeLabel] = useState(mistakeLabels[0] ?? "");
  const [target, setTarget] = useState("20");
  const [direction, setDirection] = useState<"at_least" | "at_most">("at_least");
  const [period, setPeriod] = useState<GoalPeriod>("month");

  function defaultLabel(): string {
    if (kind === "adherence") {
      const subject = GOAL_SUBJECTS.find((s) => s.key === subjectKey);
      return `${subject?.label ?? subjectKey} ${OPERATOR_LABELS[operator]} ${conditionValue}`;
    }
    if (kind === "reduction") return `Fewer: ${mistakeLabel}`;
    return METRIC_LABELS[metric];
  }

  async function addGoal() {
    setSaving(true);
    setError(null);

    const body = {
      label: label.trim() || defaultLabel(),
      kind,
      target: Number(target),
      target_direction: direction,
      period,
      ...(kind === "adherence"
        ? {
            subject_source: "core",
            subject_key: subjectKey,
            operator,
            number_value: Number(conditionValue),
          }
        : {}),
      ...(kind === "aggregate" ? { metric } : {}),
      ...(kind === "reduction" ? { mistake_label: mistakeLabel } : {}),
    };

    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Couldn't save that goal.");
      return;
    }

    // The new goal's progress is computed server-side, so reload rather than
    // guessing at it here -- a locally-invented figure could disagree with
    // every other one on the page.
    window.location.reload();
  }

  async function removeGoal(goal: Goal) {
    if (!confirm(`Delete "${goal.label}"? Your trades are not affected.`)) return;
    const res = await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Couldn't delete that goal.");
      return;
    }
    setProgress((prev) => prev.filter((p) => p.goal.id !== goal.id));
  }

  return (
    <div className="flex flex-col gap-4">
      <Card hoverable={false} className="flex flex-col">
        {progress.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No goals yet. Add one below and its progress is computed from your trades. Nothing
            here is ticked off by hand.
          </p>
        ) : (
          progress.map((p) => (
            <ProgressRow key={p.goal.id} progress={p} onDelete={removeGoal} />
          ))
        )}
      </Card>

      <Card hoverable={false} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Add a goal</h2>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as GoalKind)}
            className={inputClass}
            aria-label="Goal type"
          >
            {(Object.keys(KIND_LABELS) as GoalKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>

          {kind === "aggregate" && (
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as GoalMetric)}
              className={inputClass}
              aria-label="Measure"
            >
              {(Object.keys(METRIC_LABELS) as GoalMetric[]).map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABELS[m]}
                </option>
              ))}
            </select>
          )}

          {kind === "adherence" && (
            <>
              <select
                value={subjectKey}
                onChange={(e) => setSubjectKey(e.target.value)}
                className={inputClass}
                aria-label="Field"
              >
                {GOAL_SUBJECTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                value={operator}
                onChange={(e) => setOperator(e.target.value as "lte" | "gte")}
                className={inputClass}
                aria-label="Comparison"
              >
                <option value="lte">{OPERATOR_LABELS.lte}</option>
                <option value="gte">{OPERATOR_LABELS.gte}</option>
              </select>
              <input
                type="number"
                step="any"
                value={conditionValue}
                onChange={(e) => setConditionValue(e.target.value)}
                className={`${inputClass} w-24`}
                aria-label="Condition value"
              />
            </>
          )}

          {kind === "reduction" &&
            (mistakeLabels.length > 0 ? (
              <select
                value={mistakeLabel}
                onChange={(e) => setMistakeLabel(e.target.value)}
                className={inputClass}
                aria-label="Mistake"
              >
                {mistakeLabels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              // Refused rather than offered with free text: a goal targeting a
              // mistake nothing produces would sit at zero forever and look met.
              <span className="text-xs text-zinc-500">
                No mistakes tracked yet. Tag one on a trade, or add plan rules, and they appear
                here.
              </span>
            ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "at_least" | "at_most")}
            className={inputClass}
            aria-label="Direction"
          >
            <option value="at_least">at least</option>
            <option value="at_most">at most</option>
          </select>
          <input
            type="number"
            step="any"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={`${inputClass} w-24`}
            aria-label="Target"
          />
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as GoalPeriod)}
            className={inputClass}
            aria-label="Period"
          >
            {(Object.keys(PERIOD_LABELS) as GoalPeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={defaultLabel()}
            className={`${inputClass} min-w-[12rem] flex-1`}
            aria-label="Goal name"
          />
          <button
            onClick={addGoal}
            disabled={saving || (kind === "reduction" && mistakeLabels.length === 0)}
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
          >
            {saving ? "Saving..." : "Add goal"}
          </button>
        </div>

        <FormError>{error}</FormError>
      </Card>
    </div>
  );
}
