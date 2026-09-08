"use client";

import { useMemo, useState } from "react";
import { FormError } from "@/components/form-error";
import { Trash2 } from "lucide-react";
import {
  CORE_SUBJECTS,
  DERIVED_SUBJECTS,
  FIELD_TYPE_TO_SUBJECT_TYPE,
  NUMERIC_OPERATORS,
  OPERATORS_BY_TYPE,
  OPERATOR_LABELS,
  TEXT_OPERATORS,
  type SubjectDefinition,
} from "@/lib/plan-rules/subjects";
import type { RuleOperator, StrategyRule, SubjectSource } from "@/lib/plan-rules/types";

// The rule editor, shown under a strategy's own tab on /strategies.
//
// The form is driven by the subject catalogue: picking what to measure decides
// which comparisons are offered, which decides which value inputs appear. That
// is what stops a user building a rule the evaluator can only ever report as
// unevaluable -- "ticker is at most 5" is not an error worth explaining after
// the fact if the UI never offers it.

interface CustomFieldOption {
  key: string;
  label: string;
  field_type: string;
}

/** A subject plus where it comes from, which the evaluator needs kept
 *  distinct -- a custom field named `risk_percent` is not the column. */
interface SubjectOption extends SubjectDefinition {
  source: SubjectSource;
}

const inputClass =
  "rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

function subjectId(option: { source: SubjectSource; key: string }): string {
  return `${option.source}:${option.key}`;
}

export function RuleManager({
  strategyId,
  strategyName,
  initialRules,
  customFields,
}: {
  strategyId: string;
  strategyName: string;
  initialRules: StrategyRule[];
  customFields: CustomFieldOption[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const subjects = useMemo<SubjectOption[]>(() => {
    // Keyed so a strategy-scoped field overrides a global one of the same key,
    // matching how the evaluator resolves the value. Listing both would offer
    // two identical-looking options that score differently.
    const custom = new Map<string, SubjectOption>();
    for (const field of customFields) {
      // A field type with no sensible comparison (date, colour) is left out
      // rather than offered and then behaving oddly.
      const type = FIELD_TYPE_TO_SUBJECT_TYPE[field.field_type];
      if (!type) continue;
      custom.set(field.key, { key: field.key, label: field.label, type, source: "custom" });
    }

    return [
      ...CORE_SUBJECTS.map((s): SubjectOption => ({ ...s, source: "core" })),
      ...DERIVED_SUBJECTS.map((s): SubjectOption => ({ ...s, source: "derived" })),
      ...custom.values(),
    ];
  }, [customFields]);

  const [subjectValue, setSubjectValue] = useState(() => subjectId(subjects[0]));
  const subject = subjects.find((s) => subjectId(s) === subjectValue) ?? subjects[0];

  const allowedOperators = OPERATORS_BY_TYPE[subject.type];
  const [operator, setOperator] = useState<RuleOperator>(allowedOperators[0]);
  // Changing the subject can invalidate the chosen comparison, so fall back to
  // the first one the new subject actually supports.
  const activeOperator = allowedOperators.includes(operator) ? operator : allowedOperators[0];

  const [numberValue, setNumberValue] = useState("");
  const [numberValueMax, setNumberValueMax] = useState("");
  const [textValue, setTextValue] = useState("");
  const [label, setLabel] = useState("");

  const needsNumber = NUMERIC_OPERATORS.has(activeOperator);
  const needsMax = activeOperator === "between";
  const needsText = TEXT_OPERATORS.has(activeOperator);

  /** The label the trader gets if they don't write one, phrased the way the
   *  rule reads on the trade card. */
  function defaultLabel(): string {
    const parts = [subject.label, OPERATOR_LABELS[activeOperator]];
    if (needsMax) parts.push(`${numberValue} and ${numberValueMax}`);
    else if (needsNumber) parts.push(numberValue);
    else if (needsText) parts.push(`"${textValue}"`);
    return parts.filter(Boolean).join(" ");
  }

  async function addRule() {
    setSaving(true);
    setError(null);

    const res = await fetch("/api/strategy-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategy_id: strategyId,
        label: label.trim() || defaultLabel(),
        subject_source: subject.source,
        subject_key: subject.key,
        operator: activeOperator,
        number_value: needsNumber && numberValue !== "" ? Number(numberValue) : null,
        number_value_max: needsMax && numberValueMax !== "" ? Number(numberValueMax) : null,
        text_value: needsText ? textValue : null,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't save that rule.");
      return;
    }

    const created = (await res.json()) as StrategyRule;
    setRules((prev) => [...prev, created]);
    setLabel("");
    setNumberValue("");
    setNumberValueMax("");
    setTextValue("");
  }

  async function toggleRule(rule: StrategyRule) {
    // PATCH takes the whole definition, not a partial -- see rulePatchSchema.
    const res = await fetch(`/api/strategy-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: rule.label,
        subject_source: rule.subject_source,
        subject_key: rule.subject_key,
        operator: rule.operator,
        number_value: rule.number_value,
        number_value_max: rule.number_value_max,
        text_value: rule.text_value,
        enabled: !rule.enabled,
        sort_order: rule.sort_order,
      }),
    });
    if (!res.ok) {
      setError("Couldn't change that rule.");
      return;
    }
    const updated = (await res.json()) as StrategyRule;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
  }

  async function removeRule(rule: StrategyRule) {
    if (!confirm(`Delete "${rule.label}"? Trades are not affected.`)) return;
    const res = await fetch(`/api/strategy-rules/${rule.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Couldn't delete that rule.");
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
  }

  return (
    <div className="flex flex-col gap-4">
      {rules.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No rules yet. Add measurable conditions and every trade tagged with {strategyName} will
          be scored against them.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-subtle"
            >
              <div className="min-w-0">
                <span
                  className={`text-sm ${
                    rule.enabled
                      ? "text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-400 line-through dark:text-zinc-600"
                  }`}
                >
                  {rule.label}
                </span>
                {!rule.enabled && (
                  <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500">
                    off
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  onClick={() => toggleRule(rule)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  {rule.enabled ? "Turn off" : "Turn on"}
                </button>
                <button
                  onClick={() => removeRule(rule)}
                  title="Delete rule"
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-subtle">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Add a rule</h3>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={subjectValue}
            onChange={(e) => setSubjectValue(e.target.value)}
            className={inputClass}
            aria-label="What to check"
          >
            <optgroup label="Trade fields">
              {subjects
                .filter((s) => s.source === "core")
                .map((s) => (
                  <option key={subjectId(s)} value={subjectId(s)}>
                    {s.label}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Calculated">
              {subjects
                .filter((s) => s.source === "derived")
                .map((s) => (
                  <option key={subjectId(s)} value={subjectId(s)}>
                    {s.label}
                  </option>
                ))}
            </optgroup>
            {subjects.some((s) => s.source === "custom") && (
              <optgroup label="Your own fields">
                {subjects
                  .filter((s) => s.source === "custom")
                  .map((s) => (
                    <option key={subjectId(s)} value={subjectId(s)}>
                      {s.label}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>

          <select
            value={activeOperator}
            onChange={(e) => setOperator(e.target.value as RuleOperator)}
            className={inputClass}
            aria-label="Comparison"
          >
            {allowedOperators.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </option>
            ))}
          </select>

          {needsNumber && (
            <input
              type="number"
              step="any"
              value={numberValue}
              onChange={(e) => setNumberValue(e.target.value)}
              placeholder={subject.unit ?? "value"}
              className={`${inputClass} w-28`}
              aria-label="Value"
            />
          )}
          {needsMax && (
            <>
              <span className="text-xs text-zinc-500">and</span>
              <input
                type="number"
                step="any"
                value={numberValueMax}
                onChange={(e) => setNumberValueMax(e.target.value)}
                className={`${inputClass} w-28`}
                aria-label="Upper value"
              />
            </>
          )}
          {needsText && (
            <input
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="text"
              className={`${inputClass} w-40`}
              aria-label="Text value"
            />
          )}
        </div>

        {subject.hint && <p className="text-xs text-zinc-500">{subject.hint}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={defaultLabel()}
            className={`${inputClass} flex-1 min-w-[12rem]`}
            aria-label="Rule name"
          />
          <button
            onClick={addRule}
            disabled={saving}
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
          >
            {saving ? "Saving..." : "Add rule"}
          </button>
        </div>

        <FormError>{error}</FormError>
      </div>
    </div>
  );
}
