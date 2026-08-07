export interface TourStep {
  path: string; // the route this step lives on; the tour navigates here automatically
  targetId: string; // matches a data-tour-id attribute on that route
  title: string;
  body: string;
}

// One step per nav tab (Fields gets two — add and remove), in nav order.
// Every target is chosen to render unconditionally: a brand-new signup has
// zero trades/strategies/history, so anything data-driven (an insight card,
// an answer card, an emotion row) would be missing on the very first run
// this tour exists for. Kept as plain data so a new tab just needs one more
// entry here plus a matching data-tour-id, without touching the overlay.
export const TOUR_STEPS: TourStep[] = [
  {
    path: "/dashboard",
    targetId: "dashboard-quick-trade",
    title: "Log a trade in seconds",
    body: "This is the fastest way to get a trade in: click Quick trade, fill in a ticker and price (every field is optional), and you're done. You can always fill in the rest later.",
  },
  {
    path: "/trades",
    targetId: "trades-search",
    title: "Trades",
    body: "Every trade you log shows up here. Search by ticker, filter by status, folder, or strategy, and click into any trade for its full detail page.",
  },
  {
    path: "/strategies",
    targetId: "strategies-add",
    title: "Strategies",
    body: "Define the strategies you trade — Breakout, Reversal, whatever you use. Tag trades with them and see win rate and P/L broken down by strategy. For example, try adding one here.",
  },
  {
    path: "/analytics",
    targetId: "analytics-header",
    title: "Analytics",
    body: "Deeper performance stats below: equity curve, drawdown, win rate, profit factor, streaks, and more. These fill in automatically as you log and close trades.",
  },
  {
    path: "/insights",
    targetId: "insights-header",
    title: "Insights",
    body: "Once you have enough closed trades, patterns get surfaced here automatically — like a day of the week or a strategy where your win rate is meaningfully higher or lower than usual.",
  },
  {
    path: "/ask",
    targetId: "ask-header",
    title: "Ask",
    body: "Plain-English answers about your own trading — your best day, your best setup, how you trade after a losing streak. No AI, just your data, once you've closed a few trades.",
  },
  {
    path: "/emotions",
    targetId: "emotions-header",
    title: "Emotions",
    body: "Track how you felt before, during, and after each trade, and see how that emotional state correlates with your win rate over time.",
  },
  {
    path: "/fields",
    targetId: "fields-add",
    title: "Add a custom field",
    body: "Customize the trade form to track anything you want. For example, try adding a field here — give it a label and a type, and it'll show up on every trade.",
  },
  {
    path: "/fields",
    targetId: "fields-remove",
    title: "Remove a field",
    body: "Didn't need one of the defaults? Remove it here. Existing trade data for it is kept, just hidden — nothing is deleted.",
  },
  {
    path: "/commissions",
    targetId: "commissions-add",
    title: "Commissions",
    body: "Set up commission rules per broker or asset so they're automatically deducted from your P/L. Add one here whenever you're ready.",
  },
];
