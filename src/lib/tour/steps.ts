export interface TourStep {
  /** Exact route this step lives on. The tour navigates here itself. */
  path?: string;
  /**
   * Prefix match instead of an exact path, for dynamic routes (a trade
   * detail page is /trades/<uuid>). The tour can't navigate to these on its
   * own -- they're only reached by the user completing the previous step's
   * action -- so a prefix step is skipped if we never land on it.
   */
  pathPrefix?: string;
  /** Element carrying the matching data-tour-id. */
  targetId: string;
  title: string;
  body: string;
  /**
   * This target only exists after the user does something (opens the Quick
   * Trade modal, creates a trade). The tour waits for it instead of timing
   * out, and the previous step auto-advances the moment it appears.
   */
  awaitAction?: boolean;
}

// One step per nav tab, plus a hands-on walkthrough of logging a trade --
// the tour highlights each control in turn (Quick trade, then ticker,
// direction, entry, size, stop) so a new user is shown exactly what to fill
// in rather than just being told the tab exists.
//
// Every target that isn't `awaitAction` must render with zero data: this
// runs for accounts with no trades at all, so Insights, Ask and Emotions
// anchor to their page headers rather than to cards that don't exist yet.
export const TOUR_STEPS: TourStep[] = [
  {
    path: "/dashboard",
    targetId: "dashboard-quick-trade",
    title: "Log your first trade",
    body: "Everything starts with a trade. Click Quick trade and we'll walk through it together.",
  },
  {
    targetId: "quick-ticker",
    title: "1. Ticker",
    body: "What you traded — type a symbol like AAPL or TSLA.",
    awaitAction: true,
  },
  {
    targetId: "quick-direction",
    title: "2. Long or short",
    body: "Long if you bought expecting the price to rise. Short if you're betting it falls.",
  },
  {
    targetId: "quick-status",
    title: "3. Status",
    body: "Pending if you haven't entered yet, Open if you're in the trade right now, Closed if it's already finished.",
  },
  {
    targetId: "quick-entry",
    title: "4. Entry price",
    body: "What you paid per share. Type it and watch the next two boxes — price, shares, and dollar amount stay in sync automatically.",
  },
  {
    targetId: "quick-shares",
    title: "5. Size",
    body: "How many shares. Fill in either this or the dollar amount below and the other one works itself out.",
  },
  {
    targetId: "quick-stop",
    title: "6. Stop loss and take profit",
    body: "Where you'd cut the loss, and where you'd take the win. These are what let the app calculate your risk and R-multiples later.",
  },
  {
    targetId: "quick-create",
    title: "7. Create it",
    body: "That's the whole form — every field is optional, so you can create it now and finish the details on the next screen.",
  },
  {
    pathPrefix: "/trades/",
    targetId: "trade-detail-hero",
    title: "The full trade",
    body: "Here's the trade you just made. This page holds everything else: exit price, notes, screenshots, strategy tags, and how you felt before, during, and after.",
    awaitAction: true,
  },
  {
    path: "/trades",
    targetId: "trades-search",
    title: "Trades",
    body: "Every trade you log lands here. Search by ticker, filter by status, folder, or strategy, and click any trade to open it.",
  },
  {
    path: "/strategies",
    targetId: "strategies-add",
    title: "Strategies",
    body: "Name the strategies you trade — Breakout, Reversal, whatever you use — then tag trades with them to see which ones actually make money.",
  },
  {
    path: "/analytics",
    targetId: "analytics-header",
    title: "Analytics",
    body: "Deeper performance stats below: equity curve, drawdown, win rate, profit factor, streaks, and more. These fill in as you close trades.",
  },
  {
    path: "/insights",
    targetId: "insights-header",
    title: "Insights",
    body: "Once you have enough closed trades, patterns get surfaced here automatically — a day of the week or a strategy where your win rate is unusually high or low.",
  },
  {
    path: "/ask",
    targetId: "ask-header",
    title: "Ask",
    body: "Plain-English answers about your own trading — your best day, your best setup, how you trade after a losing streak. No AI, just your data.",
  },
  {
    path: "/emotions",
    targetId: "emotions-header",
    title: "Emotions",
    body: "Track how you felt before, during, and after each trade, and see how that state of mind lines up with your win rate.",
  },
  {
    path: "/fields",
    targetId: "fields-add",
    title: "Add a custom field",
    body: "Track anything you want on a trade. Give it a label, pick a type, and it appears on every trade form.",
  },
  {
    path: "/fields",
    targetId: "fields-remove",
    title: "Remove a field",
    body: "Don't need one of the defaults? Remove it here. Data already saved under it is kept, just hidden.",
  },
  {
    path: "/commissions",
    targetId: "commissions-add",
    title: "Commissions",
    body: "Tell the journal what your broker charges and every trade's P/L is recorded net of fees, automatically.",
  },
];
