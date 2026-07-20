export interface TourStep {
  targetId: string; // matches a data-tour-id attribute
  title: string;
  body: string;
}

// One step per nav item, in the order they appear in the nav bar. Kept as
// plain data (not JSX) so it's easy to add a step alongside a new page
// without touching the overlay component itself.
export const TOUR_STEPS: TourStep[] = [
  {
    targetId: "nav-dashboard",
    title: "Dashboard",
    body: "Your at-a-glance summary: recent P/L, an account cash tracker, and your best/worst strategy by total profit.",
  },
  {
    targetId: "nav-trades",
    title: "Trades",
    body: "Every trade you've logged. Filter by status, folder, strategy, or market, and click into any trade to fill in its full details.",
  },
  {
    targetId: "nav-strategies",
    title: "Strategies",
    body: "Define the strategies you trade (Breakout, Reversal, etc.), tag trades with them, and see win rate and P/L broken down by strategy. Each strategy can have its own custom fields.",
  },
  {
    targetId: "nav-analytics",
    title: "Analytics",
    body: "Deeper performance stats: equity curve, drawdown, R-multiple distribution, win rate by direction and by strategy, and streaks.",
  },
  {
    targetId: "nav-insights",
    title: "Insights",
    body: "Automatically surfaced patterns in your results -- e.g. a day of the week or strategy where your win rate is meaningfully higher or lower than usual.",
  },
  {
    targetId: "nav-ask",
    title: "Ask",
    body: "Plain-English answers to common questions about your trading -- your best day, your best setup, how you trade after a losing streak, and more.",
  },
  {
    targetId: "nav-emotions",
    title: "Emotions",
    body: "Track how you felt before, during, and after each trade, and see how that emotional state correlates with your win rate.",
  },
  {
    targetId: "nav-fields",
    title: "Fields",
    body: "Customize the trade form: show or hide built-in fields, add your own custom fields, and manage folders for organizing trades.",
  },
];
