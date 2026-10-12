// The tabbed tour's copy (Phase 3B of docs/design-audit.md), approved by Alon
// on 2026-09-27. Plain data, so tour-content.test.ts can hold the badges to
// the app's real paid gates: a tab marked FREE that the app locks loses a
// customer, one marked PAID that it doesn't loses a signup.
//
// Every bullet restates copy that was already on the homepage (the feature
// stories, What's included, How it works) -- no new claims.

export type TourVisual = "rules" | "excursion" | "edge" | "import" | "review";

export interface TourTab {
  id: string;
  /** The tab's own label. */
  label: string;
  eyebrow: string;
  headline: string;
  bullets: [string, string, string];
  paid: boolean;
  visual: TourVisual;
}

export const TOUR_TABS: TourTab[] = [
  {
    id: "rules",
    label: "Rules & mistakes",
    eyebrow: "Rules & mistakes",
    headline: "Hold yourself to your own plan",
    bullets: [
      "Write the rules you actually trade by, and every trade comes back pass or fail.",
      "A rule the app can’t check is left out of your score, not counted as a pass.",
      "Moved stops, sized-up positions and early exits are caught without you tagging them.",
    ],
    paid: false,
    visual: "rules",
  },
  {
    id: "mae-mfe",
    label: "MAE/MFE",
    eyebrow: "MAE / MFE",
    headline: "See the heat you sat through",
    bullets: [
      "How far each trade went against you after entry, and how far it ran for you before you closed.",
      "How much of each move you actually captured.",
      "It tells a stop set too tight apart from a thesis that was wrong.",
    ],
    paid: true,
    visual: "excursion",
  },
  {
    id: "edge",
    label: "Find my edge",
    eyebrow: "Find my edge",
    headline: "Which of your setups is carrying the rest",
    bullets: [
      "Setup, ticker, direction, day, hold time, even the mood you logged.",
      "Ranked by expectancy: strongest edges on one side, biggest leaks on the other.",
      "Each row shows how many trades it rests on, so a fluke can’t pass for a pattern.",
    ],
    paid: true,
    visual: "edge",
  },
  {
    id: "import",
    label: "Import",
    eyebrow: "Import",
    headline: "Get a trade in without retyping it",
    bullets: [
      "Screenshot import, confirmed for Interactive Brokers stock trades.",
      "The app’s own reader parses it; nothing goes to an AI service unless you choose to.",
      "Manual entry for any broker or market, and export to Excel (XLSX).",
    ],
    paid: false,
    visual: "import",
  },
  {
    id: "ai-review",
    label: "AI review",
    eyebrow: "AI review",
    headline: "Graded on execution, not outcome",
    bullets: [
      "Any closed trade scored out of 100 on setup, entry, risk, exit, plan and discipline.",
      "A winning trade can still score poorly.",
      "Runs on your own AI key. Free provider tiers are plenty.",
    ],
    paid: true,
    visual: "review",
  },
];
