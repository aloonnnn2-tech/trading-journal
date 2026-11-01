"use client";

import { useId, useState } from "react";
import { Printer } from "lucide-react";
import { CARD } from "@/components/landing/calculator-fields";
import { CopyButton } from "@/components/landing/copy-button";
import { examplePlan, formatPlanText, PLAN_SECTIONS, type PlanValues } from "@/lib/free-tools/trading-plan";

// The builder on /trading-plan-template: a form on one side, the finished
// one-page plan on the other, updating as you type. Answers live in component
// state only -- nothing is stored or sent -- so the page says plainly to copy
// or print before leaving.
//
// Print shows only the plan card (everything else is print:hidden), in black
// on white whatever the theme.

const INPUT =
  "mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-primary focus:ring-1 focus:ring-primary dark:border-subtle dark:bg-deep dark:text-zinc-50 dark:placeholder:text-zinc-600";

const SMALL_BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:border-primary hover:text-primary dark:border-subtle dark:text-zinc-400";

export function TradingPlanBuilder() {
  const [name, setName] = useState("");
  const [values, setValues] = useState<PlanValues>({});
  const id = useId();
  const text = formatPlanText(values, name);
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <div className="grid gap-6 md:grid-cols-2 print:block">
      <form onSubmit={(e) => e.preventDefault()} className={`${CARD} print:hidden`} aria-label="Your trading plan">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setValues(examplePlan())} className={SMALL_BUTTON}>
            Fill in an example
          </button>
          <button
            type="button"
            onClick={() => {
              setValues({});
              setName("");
            }}
            className={SMALL_BUTTON}
          >
            Clear
          </button>
        </div>

        <div>
          <label htmlFor={`${id}-name`} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Your name <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="off" />
        </div>

        {PLAN_SECTIONS.map((section) => (
          <fieldset key={section.heading} className="flex flex-col gap-4">
            <legend className="mb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              {section.heading}
            </legend>
            {section.fields.map((field) => {
              const inputId = `${id}-${field.key}`;
              const props = {
                id: inputId,
                value: values[field.key] ?? "",
                placeholder: field.example,
                className: INPUT,
              };
              return (
                <div key={field.key}>
                  <label htmlFor={inputId} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {field.label}
                  </label>
                  {field.multiline ? (
                    <textarea {...props} rows={3} onChange={(e) => set(field.key, e.target.value)} />
                  ) : (
                    <input {...props} autoComplete="off" onChange={(e) => set(field.key, e.target.value)} />
                  )}
                </div>
              );
            })}
          </fieldset>
        ))}
      </form>

      <section
        aria-label="Plan preview"
        className={`${CARD} md:sticky md:top-20 md:self-start print:border-0 print:bg-white print:p-0 print:**:text-black`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">Your plan</p>
          <div className="flex gap-2">
            {text && <CopyButton text={text} label="Copy as text" />}
            <button type="button" onClick={() => window.print()} className={SMALL_BUTTON} disabled={!text}>
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print / PDF
            </button>
          </div>
        </div>

        {text ? (
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 print:text-3xl">
              Trading plan{name.trim() && `: ${name.trim()}`}
            </h2>
            {PLAN_SECTIONS.map((section) => {
              const filled = section.fields.filter((f) => (values[f.key] ?? "").trim());
              if (filled.length === 0) return null;
              return (
                <div key={section.heading} className="mt-5">
                  <h3 className="border-b border-zinc-200 pb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-primary dark:border-subtle">
                    {section.heading}
                  </h3>
                  <dl className="mt-2 flex flex-col gap-2.5">
                    {filled.map((f) => (
                      <div key={f.key}>
                        <dt className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{f.label}</dt>
                        <dd className="whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                          {values[f.key].trim()}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
            <p className="hidden text-xs print:mt-8 print:block">
              Made with the free template at tradinglenz.netlify.app/trading-plan-template · A trading
              journal and education tool. Not financial advice.
            </p>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-zinc-500">
            Your plan appears here as you fill in the boxes. Not sure where to start? Press{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Fill in an example</span> and
            change it to fit you.
          </p>
        )}

        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-500 dark:bg-white/5 print:hidden">
          Nothing is saved or sent. Copy or print your plan before you leave this page.
        </p>
      </section>
    </div>
  );
}
