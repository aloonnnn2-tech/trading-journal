// The questions on /trading-checklist. Phrased as statements you can tick
// only when they are true, so an unticked box is a reason to wait.

export interface ChecklistGroup {
  heading: string;
  items: string[];
}

export const CHECKLIST: ChecklistGroup[] = [
  {
    heading: "Market and setup",
    items: [
      "The broader market supports this direction, or I know why it doesn't matter here.",
      "This is a setup from my trading plan, and I can name it.",
      "I can say in one sentence why I'm taking it now.",
      "There's no earnings report or big event before my planned exit, or I've planned for it.",
    ],
  },
  {
    heading: "Risk and size",
    items: [
      "My stop is where the idea is proven wrong, and it's written down.",
      "My target is realistic, and the reward : risk meets my minimum.",
      "My position size comes from my risk %, not from a feeling.",
      "If the stop is hit, I'm fine with the loss.",
      "This trade keeps me inside my max open positions and daily loss limit.",
    ],
  },
  {
    heading: "Mindset",
    items: [
      "I'm not taking this trade to win back a loss.",
      "I'm calm, rested and not rushed.",
      "I'd take this trade even if nobody else were talking about it.",
    ],
  },
];

export const CHECKLIST_COUNT = CHECKLIST.reduce((n, g) => n + g.items.length, 0);
