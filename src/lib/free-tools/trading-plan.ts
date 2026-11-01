// The fields and the plain-text output of /trading-plan-template. Pure, so
// "Copy as text" and the unit tests agree on the format.

export interface PlanField {
  key: string;
  label: string;
  /** Shown as the input's placeholder, and loaded by "Fill in an example". */
  example: string;
  multiline?: boolean;
}

export interface PlanSection {
  heading: string;
  fields: PlanField[];
}

export const PLAN_SECTIONS: PlanSection[] = [
  {
    heading: "What I trade",
    fields: [
      {
        key: "goal",
        label: "My goal",
        example: "Grow my account steadily with swing trades, using money I can afford to lose.",
        multiline: true,
      },
      { key: "markets", label: "Markets", example: "US stocks priced over $5 that trade over 1M shares a day." },
      { key: "timeframe", label: "Timeframe", example: "Daily charts. Trades held 2 to 10 days." },
      {
        key: "setups",
        label: "Setups",
        example: "1. Breakout from a base of 3 weeks or more.\n2. Pullback to a rising 20-day average.",
        multiline: true,
      },
    ],
  },
  {
    heading: "Risk",
    fields: [
      {
        key: "riskPerTrade",
        label: "Risk per trade",
        example: "1% of my account, sized from the distance between entry and stop.",
      },
      { key: "lossLimits", label: "Loss limits", example: "Stop for the day at −3R. Stop for the week at −6R and review." },
      { key: "maxPositions", label: "Max open positions", example: "5" },
    ],
  },
  {
    heading: "Rules",
    fields: [
      {
        key: "entryRules",
        label: "Entry rules",
        example: "Only setups from this plan. Planned reward : risk of 2 : 1 or better. Stop and target written before the order.",
        multiline: true,
      },
      {
        key: "exitRules",
        label: "Exit rules",
        example: "Out when the stop is hit. Sell half at 2R and move the stop to break-even. Never widen the stop.",
        multiline: true,
      },
    ],
  },
  {
    heading: "Routine",
    fields: [
      {
        key: "routine",
        label: "Daily routine",
        example: "Before the open: check the market and my watchlist. After the close: log the day's trades.",
        multiline: true,
      },
      {
        key: "review",
        label: "Review",
        example: "Every weekend: total R, mistakes and rules broken. Change one thing at a time.",
        multiline: true,
      },
    ],
  },
];

export const PLAN_FIELDS = PLAN_SECTIONS.flatMap((s) => s.fields);

export type PlanValues = Record<string, string>;

export function examplePlan(): PlanValues {
  return Object.fromEntries(PLAN_FIELDS.map((f) => [f.key, f.example]));
}

/**
 * The plan as plain text, for pasting into notes or an email. Empty fields
 * and empty sections are left out; a multi-line answer goes on its own lines
 * under its label. Returns "" when nothing is filled in.
 */
export function formatPlanText(values: PlanValues, name = ""): string {
  const sections = PLAN_SECTIONS.map((section) => {
    const lines = section.fields.flatMap((field) => {
      const value = (values[field.key] ?? "").trim();
      if (!value) return [];
      return value.includes("\n")
        ? [`${field.label}:`, ...value.split("\n").map((line) => `  ${line.trim()}`)]
        : [`${field.label}: ${value}`];
    });
    return lines.length ? [section.heading.toUpperCase(), ...lines].join("\n") : null;
  }).filter((s): s is string => s !== null);

  if (sections.length === 0) return "";
  const title = name.trim() ? `TRADING PLAN: ${name.trim()}` : "TRADING PLAN";
  return [title, ...sections].join("\n\n");
}
