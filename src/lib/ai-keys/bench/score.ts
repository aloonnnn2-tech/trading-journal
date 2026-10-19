// Scoring for the Ask benchmark (scripts/ask-bench). Pure: given a fact the
// right answer must contain and a piece of text (a tool's output, or the
// model's final answer), say whether the text states it.
//
// Deliberately forgiving about FORMAT -- "$1,235", "1234.56" and "-1,234.6"
// all state the same P/L, "45%" and "0.45" the same win rate -- and strict
// about the VALUE: about 1% either way, so a rounded figure passes and a
// different one does not.

export type Fact =
  | {
      label: string;
      /** The value as the app computes it. */
      number: number;
      /** A 0..1 ratio the text may write as a percentage. */
      percent?: boolean;
    }
  | {
      label: string;
      /** Any of these names, compared without case, underscores or hyphens. */
      text: string[];
    };

/** Every number written in the text, with $, thousands commas and a leading minus understood. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const cleaned = text.replace(/−/g, "-");
  // Not part of a word or an id: "gpt-4o", "m12" and "abc123" carry no figure.
  for (const m of cleaned.matchAll(/(?<![\w.\-])-?\$?\s?\d[\d,]*(?:\.\d+)?(?!\w)/g)) {
    const n = Number(m[0].replace(/[$,\s]/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(b) * 0.012, 0.011);
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function factFound(fact: Fact, text: string): boolean {
  if ("text" in fact) {
    const hay = normalise(text);
    return fact.text.some((t) => hay.includes(normalise(t)));
  }
  // Sign is not required: "lost $120" states a P/L of -120.
  const targets = [Math.abs(fact.number)];
  if (fact.percent) targets.push(Math.abs(fact.number * 100));
  return numbersIn(text).some((n) => targets.some((t) => close(Math.abs(n), t)));
}

export interface QuestionScore {
  found: string[];
  missing: string[];
  /** Every fact stated, and (when tools were expected) one of them used. */
  pass: boolean;
  toolHit: boolean | null;
}

export function scoreAnswer(
  facts: Fact[],
  text: string,
  expectedTools: string[],
  usedTools: string[] | null,
): QuestionScore {
  const found = facts.filter((f) => factFound(f, text)).map((f) => f.label);
  const missing = facts.filter((f) => !factFound(f, text)).map((f) => f.label);
  const toolHit =
    usedTools === null || expectedTools.length === 0 ? null : expectedTools.some((t) => usedTools.includes(t));
  return { found, missing, toolHit, pass: missing.length === 0 && toolHit !== false };
}
