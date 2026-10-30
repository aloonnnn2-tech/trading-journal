"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { FormError } from "@/components/form-error";
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
import type { RuleOperator, SubjectSource } from "@/lib/plan-rules/types";
import type { EntryTemplate, OverallRule, OverallRuleKind, RuleDirection } from "@/lib/overall-rules/types";

// Overall rules (0081): one list every trade is checked against, on
// /strategies. The app checks field and moving-average rules from the
// trade's data and real daily prices; rules in words are judged by the AI
// review only, and the form says so.

const inputClass =
  "rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

const KINDS: { value: OverallRuleKind; label: string; hint: string }[] = [
  { value: "ma_exit", label: "Moving-average exit", hint: "Checked against real daily closes while the trade was open." },
  { value: "ma_entry", label: "Moving-average entry", hint: "Checked against the averages on the day before you entered." },
  { value: "field", label: "Trade value", hint: "Checked against what you logged on the trade." },
  { value: "text", label: "In words", hint: "The app can't measure this one. The AI review judges it and says how sure it is." },
];

const KIND_BADGE: Record<OverallRuleKind, string> = {
  ma_exit: "MA exit",
  ma_entry: "MA entry",
  field: "Trade value",
  text: "AI judges",
};

interface CustomFieldOption {
  key: string;
  label: string;
  field_type: string;
}

interface SubjectOption extends SubjectDefinition {
  source: SubjectSource;
}

const subjectId = (o: { source: SubjectSource; key: string }) => `${o.source}:${o.key}`;

export function OverallRulesManager({
  initialRules,
  customFields,
  ready,
}: {
  initialRules: OverallRule[];
  customFields: CustomFieldOption[];
  /** False until migration 0081 is applied. */
  ready: boolean;
}) {
  const [rules, setRules] = useState(initialRules);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  const [kind, setKind] = useState<OverallRuleKind>("ma_exit");
  const [direction, setDirection] = useState<RuleDirection>("both");
  const [label, setLabel] = useState("");
  // Moving averages.
  const [maType, setMaType] = useState<"sma" | "ema">("sma");
  const [maPeriod, setMaPeriod] = useState("150");
  const [maType2, setMaType2] = useState<"sma" | "ema">("sma");
  const [maPeriod2, setMaPeriod2] = useState("200");
  const [graceDays, setGraceDays] = useState("1");
  const [template, setTemplate] = useState<EntryTemplate>("price_above_ma");
  // Trade values.
  const subjects = useMemo<SubjectOption[]>(() => {
    const custom = new Map<string, SubjectOption>();
    for (const f of customFields) {
      const type = FIELD_TYPE_TO_SUBJECT_TYPE[f.field_type];
      if (type) custom.set(f.key, { key: f.key, label: f.label, type, source: "custom" });
    }
    return [
      ...CORE_SUBJECTS.map((s): SubjectOption => ({ ...s, source: "core" })),
      ...DERIVED_SUBJECTS.map((s): SubjectOption => ({ ...s, source: "derived" })),
      ...custom.values(),
    ];
  }, [customFields]);
  const [subjectValue, setSubjectValue] = useState(() => subjectId(subjects[0]));
  const subject = subjects.find((s) => subjectId(s) === subjectValue) ?? subjects[0];
  const allowed = OPERATORS_BY_TYPE[subject.type];
  const [operator, setOperator] = useState<RuleOperator>(allowed[0]);
  const activeOperator = allowed.includes(operator) ? operator : allowed[0];
  const [numberValue, setNumberValue] = useState("");
  const [numberValueMax, setNumberValueMax] = useState("");
  const [textValue, setTextValue] = useState("");
  const needsNumber = NUMERIC_OPERATORS.has(activeOperator);
  const needsMax = activeOperator === "between";
  const needsText = TEXT_OPERATORS.has(activeOperator);

  const ma1 = `${maType.toUpperCase()} ${maPeriod || "?"}`;
  const ma2 = `${maType2.toUpperCase()} ${maPeriod2 || "?"}`;

  /** The rule as it reads on a trade, when no name is written. */
  function defaultLabel(): string {
    const side = direction === "short" ? "above" : "below";
    switch (kind) {
      case "ma_exit":
        return direction === "both"
          ? `Exit when the close crosses the ${ma1} (below for longs, above for shorts)`
          : `Exit when the close is ${side} the ${ma1}`;
      case "ma_entry":
        if (template === "ma_above_ma") {
          return direction === "short" ? `Short only with the ${ma1} below the ${ma2}` : `Enter only with the ${ma1} above the ${ma2}`;
        }
        return direction === "short" ? `Short only below the ${ma1}` : `Enter only above the ${ma1}`;
      case "field": {
        const parts = [subject.label, OPERATOR_LABELS[activeOperator]];
        if (needsMax) parts.push(`${numberValue} and ${numberValueMax}`);
        else if (needsNumber) parts.push(numberValue);
        else if (needsText) parts.push(`"${textValue}"`);
        return parts.filter(Boolean).join(" ");
      }
      case "text":
        return "";
    }
  }

  function payload(): Record<string, unknown> {
    const base = { kind, direction, label: label.trim() || defaultLabel() };
    if (kind === "ma_exit") return { ...base, ma_type: maType, ma_period: toInt(maPeriod), grace_days: toInt(graceDays) ?? 1 };
    if (kind === "ma_entry") {
      return {
        ...base,
        entry_template: template,
        ma_type: maType,
        ma_period: toInt(maPeriod),
        ...(template === "ma_above_ma" ? { ma_type_2: maType2, ma_period_2: toInt(maPeriod2) } : {}),
      };
    }
    if (kind === "field") {
      return {
        ...base,
        subject_source: subject.source,
        subject_key: subject.key,
        operator: activeOperator,
        number_value: needsNumber && numberValue !== "" ? Number(numberValue) : null,
        number_value_max: needsMax && numberValueMax !== "" ? Number(numberValueMax) : null,
        text_value: needsText ? textValue : null,
      };
    }
    return base;
  }

  async function addRule() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/overall-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const body = (await res.json().catch(() => null)) as (OverallRule & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? "Couldn't save that rule.");
      setRules((prev) => [...prev, body]);
      setLabel("");
      setNumberValue("");
      setNumberValueMax("");
      setTextValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that rule.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: OverallRule) {
    // The whole definition: PATCH validates the rule as a whole.
    const { id: _id, updated_at: _u, ...definition } = rule;
    const res = await fetch(`/api/overall-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...definition, enabled: !rule.enabled }),
    });
    if (!res.ok) return setError("Couldn't change that rule.");
    const updated = (await res.json()) as OverallRule;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
  }

  async function removeRule(rule: OverallRule) {
    if (!confirm(`Delete "${rule.label}"? Your trades aren't changed.`)) return;
    const res = await fetch(`/api/overall-rules/${rule.id}`, { method: "DELETE" });
    if (!res.ok) return setError("Couldn't delete that rule.");
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
  }

  async function checkAll() {
    setChecking(true);
    setCheckNote(null);
    setError(null);
    try {
      const res = await fetch("/api/overall-rules/check", { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { checked?: number; deferred?: number; noData?: number; error?: string }
        | null;
      if (!res.ok || !body) throw new Error(body?.error ?? "Couldn't check your trades.");
      const parts = [`Checked ${body.checked ?? 0} rule${body.checked === 1 ? "" : "s"} against prices.`];
      if (body.deferred) parts.push(`${body.deferred} ticker${body.deferred === 1 ? "" : "s"} left: run it again in a few minutes.`);
      if (body.noData) parts.push(`No prices found for ${body.noData} ticker${body.noData === 1 ? "" : "s"}.`);
      if (!body.checked && !body.deferred) parts.splice(0, 1, "Everything is already up to date.");
      setCheckNote(parts.join(" "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check your trades.");
    } finally {
      setChecking(false);
    }
  }

  if (!ready) {
    return <p className="text-sm text-zinc-500">Overall rules aren&apos;t switched on yet (a database migration is pending).</p>;
  }

  const hasMarketRules = rules.some((r) => r.enabled && (r.kind === "ma_exit" || r.kind === "ma_entry"));

  return (
    <div className="flex flex-col gap-4">
      {rules.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No rules yet. Write down the rules you trade by, like &quot;exit when the close drops below the SMA 150&quot;,
          and every trade shows whether you kept them. Each month&apos;s report adds it up.
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
                  className={`text-sm break-words ${
                    rule.enabled ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 line-through dark:text-zinc-600"
                  }`}
                >
                  {rule.label}
                </span>
                <span className="ml-2 inline-block rounded-full bg-zinc-500/10 px-2 py-0.5 text-[11px] text-zinc-500">
                  {KIND_BADGE[rule.kind]}
                  {rule.direction !== "both" ? ` · ${rule.direction}s only` : ""}
                </span>
                {!rule.enabled && (
                  <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500">off</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button onClick={() => toggleRule(rule)} className="text-xs text-zinc-500 hover:text-zinc-300">
                  {rule.enabled ? "Turn off" : "Turn on"}
                </button>
                <button onClick={() => removeRule(rule)} title="Delete rule" className="text-red-400 hover:text-red-300">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hasMarketRules && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={checkAll}
            disabled={checking}
            className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
          >
            {checking ? "Checking…" : "Check all my trades"}
          </button>
          <span className="text-xs text-zinc-500">
            {checkNote ?? "Trades are also checked when you open them and before a monthly review."}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-subtle">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Add a rule</h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind of rule">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`rounded-full border px-3 py-1 text-xs ${
                kind === k.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-zinc-300 text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500">{KINDS.find((k) => k.value === kind)?.hint}</p>

        {(kind === "ma_exit" || kind === "ma_entry") && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            {kind === "ma_entry" && (
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value as EntryTemplate)}
                className={inputClass}
                aria-label="Entry rule"
              >
                <option value="price_above_ma">Price above an average</option>
                <option value="ma_above_ma">One average above another</option>
              </select>
            )}
            <MaPicker type={maType} period={maPeriod} onType={setMaType} onPeriod={setMaPeriod} label="Average" />
            {kind === "ma_entry" && template === "ma_above_ma" && (
              <>
                <span className="text-xs text-zinc-500">above</span>
                <MaPicker type={maType2} period={maPeriod2} onType={setMaType2} onPeriod={setMaPeriod2} label="Second average" />
              </>
            )}
            {kind === "ma_exit" && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                Out within
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={graceDays}
                  onChange={(e) => setGraceDays(e.target.value)}
                  className={`${inputClass} w-16`}
                  aria-label="Trading days to get out"
                />
                trading day(s) of that close
              </label>
            )}
          </div>
        )}

        {kind === "field" && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={subjectValue} onChange={(e) => setSubjectValue(e.target.value)} className={inputClass} aria-label="What to check">
              <optgroup label="Trade fields">
                {subjects.filter((s) => s.source === "core").map((s) => (
                  <option key={subjectId(s)} value={subjectId(s)}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Calculated">
                {subjects.filter((s) => s.source === "derived").map((s) => (
                  <option key={subjectId(s)} value={subjectId(s)}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              {subjects.some((s) => s.source === "custom") && (
                <optgroup label="Your own fields">
                  {subjects.filter((s) => s.source === "custom").map((s) => (
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
              {allowed.map((op) => (
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
              <input value={textValue} onChange={(e) => setTextValue(e.target.value)} placeholder="text" className={`${inputClass} w-40`} aria-label="Text value" />
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {kind === "text" ? (
            <textarea
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="e.g. No trades in the first 15 minutes after the open"
              className={`${inputClass} min-w-[12rem] flex-1`}
              aria-label="The rule"
            />
          ) : (
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={300}
              placeholder={defaultLabel()}
              className={`${inputClass} min-w-[12rem] flex-1`}
              aria-label="Rule name (optional)"
            />
          )}
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as RuleDirection)}
            className={inputClass}
            aria-label="Which trades"
          >
            <option value="both">Longs and shorts</option>
            <option value="long">Longs only</option>
            <option value="short">Shorts only</option>
          </select>
          <button
            onClick={addRule}
            disabled={saving || (kind === "text" && !label.trim())}
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
          >
            {saving ? "Saving…" : "Add rule"}
          </button>
        </div>
        <FormError>{error}</FormError>
      </div>
    </div>
  );
}

function MaPicker({
  type,
  period,
  onType,
  onPeriod,
  label,
}: {
  type: "sma" | "ema";
  period: string;
  onType: (v: "sma" | "ema") => void;
  onPeriod: (v: string) => void;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <select value={type} onChange={(e) => onType(e.target.value as "sma" | "ema")} className={inputClass} aria-label={`${label} type`}>
        <option value="sma">SMA</option>
        <option value="ema">EMA</option>
      </select>
      <input
        type="number"
        min={2}
        max={400}
        value={period}
        onChange={(e) => onPeriod(e.target.value)}
        className={`${inputClass} w-20`}
        aria-label={`${label} days`}
      />
      <span className="text-xs text-zinc-500">days</span>
    </span>
  );
}

function toInt(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}
