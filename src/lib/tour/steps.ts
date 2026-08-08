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

// Deliberately short. An onboarding tour is competing with the user's
// patience, so this walks them through logging one trade properly and then
// name-checks the rest in passing rather than stopping on every tab -- the
// app should come across as smaller than it is. Each step mentions its
// neighbours ("Insights, Ask and Emotions sit next door") so nothing is
// hidden, it just isn't a separate stop.
//
// Every target that isn't `awaitAction` must render with zero data: this
// runs for accounts with no trades at all, so Analytics anchors to its page
// header rather than to cards that don't exist yet.
export const TOUR_STEPS: TourStep[] = [
  {
    path: "/dashboard",
    targetId: "dashboard-quick-trade",
    title: "Log your first trade",
    body: "Everything starts here. Click Quick trade and we'll fill one in together — it takes about ten seconds.",
  },
  {
    targetId: "quick-ticker",
    title: "What you traded",
    body: "Type a symbol like AAPL. Just below, say whether you went long or short and whether the trade is pending, open, or already closed.",
    awaitAction: true,
  },
  {
    targetId: "quick-entry",
    title: "Your numbers",
    body: "Enter what you paid per share, then either the share count or the dollar amount — the app works out the rest. Stop loss and take profit underneath are what power the risk stats later.",
  },
  {
    targetId: "quick-create",
    title: "That's the whole form",
    body: "Every field here is optional, so you never have to have all the answers up front. Create it and we'll look at where the detail goes.",
  },
  {
    pathPrefix: "/trades/",
    targetId: "trade-detail-hero",
    title: "The rest of the story",
    body: "This is your trade. Everything else lives on this page — exit price, notes, screenshots, strategy tags, and how you felt before, during, and after it.",
    awaitAction: true,
  },
  {
    path: "/trades",
    targetId: "trades-search",
    title: "Finding trades later",
    body: "Every trade lands in this list. Search by ticker or filter by status, folder, and strategy to pull up exactly the ones you want to review.",
  },
  {
    path: "/strategies",
    targetId: "strategies-add",
    title: "Strategies",
    body: "Name the setups you trade, tag your trades with them, and the app shows you which ones actually make money. Commissions works the same way — tell it your broker's fees once and P/L is always net.",
  },
  {
    path: "/analytics",
    targetId: "analytics-header",
    title: "Where it pays off",
    body: "Equity curve, drawdown, win rate, profit factor and streaks build up here as you close trades. Insights, Ask and Emotions sit next door and go further — patterns you didn't ask about, plain-English answers, and how your mood tracks your results.",
  },
  {
    path: "/fields",
    targetId: "fields-add",
    title: "Make it yours",
    body: "Add a field to track anything the app doesn't already, or remove any default you don't want — old data is kept, just hidden. That's the tour; log a few trades and the rest fills itself in.",
  },
];
