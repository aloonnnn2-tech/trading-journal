export interface TourStep {
  /** Exact route this step lives on. Advancing into it navigates there. */
  path?: string;
  /**
   * Prefix match for dynamic routes (a trade page is /trades/<uuid>). The tour
   * cannot navigate to one of these itself; it is reached by the user doing
   * something, and skipped over when it never is.
   */
  pathPrefix?: string;
  /** Element carrying the matching data-tour-id. */
  targetId: string;
  /** Short place name for the card's eyebrow. */
  where: string;
  title: string;
  /** One sentence. The card has no scrollbar and never will. */
  body: string;
  /**
   * A task step: what the user is being asked to do, shown as "Your turn".
   * The step advances on its own the moment `done` is true, however the user
   * got there; the primary button offers to skip it instead.
   */
  action?: string;
  /** When a task counts as done: a route the user lands on, or an element that appears. */
  done?: { route: string } | { target: string };
  /**
   * If this step's target disappears and no navigation follows, go back a
   * step rather than wait on a form that has been closed.
   */
  retreat?: boolean;
}

// The core tour. Nine stops, one sentence each, in the order a new account
// meets them: log a trade, see where it lives, meet the rules that grade it,
// then the three places the journal pays off. Every target renders on a
// fresh account with zero trades except the two task steps, which wait.
export const TOUR_STEPS: TourStep[] = [
  {
    path: "/dashboard",
    targetId: "dashboard-quick-trade",
    where: "Dashboard",
    title: "Log your first trade",
    body: "Ticker, direction and price are enough. Everything else can wait.",
    action: "Click Quick trade.",
    done: { target: "quick-ticker" },
  },
  {
    targetId: "quick-ticker",
    where: "Quick trade",
    title: "Just the essentials",
    body: "Every other field is optional and lives on the trade page.",
    action: "Type a symbol, pick long or short, then Create trade.",
    done: { route: "/trades/" },
    retreat: true,
  },
  {
    pathPrefix: "/trades/",
    targetId: "trade-detail-hero",
    where: "Trade",
    title: "Everything about it lives here",
    body: "Exit, notes, screenshots, strategy, how you felt. It saves as you type.",
  },
  {
    pathPrefix: "/trades/",
    targetId: "trade-plan-adherence",
    where: "Trade",
    title: "Your rules grade every trade",
    body: "Tag a strategy and each of its rules is checked for you; the misses feed Mistakes and Insights.",
  },
  {
    path: "/strategies",
    targetId: "strategies-add",
    where: "Strategies",
    title: "Name the setups you trade",
    body: "Add one, then write the rules you trade it by.",
  },
  {
    path: "/trades",
    targetId: "trades-screenshot",
    where: "Trades",
    title: "Or skip the typing",
    body: "Drop in a broker screenshot and the app reads ticker, price and size itself. Import takes CSV and Excel.",
  },
  {
    path: "/insights",
    targetId: "tour-mistakes",
    where: "Insights",
    title: "Mistakes, counted from the data",
    body: "Moved stops, oversized positions, early exits, read from your trades. Find My Edge below ranks what pays.",
  },
  {
    path: "/analytics",
    targetId: "analytics-header",
    where: "Analytics",
    title: "Where it pays off",
    body: "Equity, drawdown, win rate, expectancy, all from closed trades. It fills in as you log.",
  },
  {
    targetId: "nav-help",
    where: "Anywhere",
    title: "That's the core",
    body: "Replay this any time from here. Goals, reports and the AI tools are one menu away.",
  },
];

// The second tour: the free features the core tour walked past, and only
// the free ones -- everything the paid plan unlocks has its own tour below.
// It deliberately shares no stop with the core tour, so the two never look
// alike: it opens on importing history, not on the Strategies button.
export const FEATURE_TOUR_STEPS: TourStep[] = [
  {
    path: "/trades",
    targetId: "trades-import",
    where: "Trades",
    title: "Bring your history in",
    body: "A CSV, Excel or JSON export from your broker loads in one sitting.",
  },
  {
    path: "/trades",
    targetId: "trades-export",
    where: "Trades",
    title: "And take it out again",
    body: "Every trade exports to CSV, Excel or JSON whenever you want it; nothing is locked in.",
  },
  {
    path: "/dashboard",
    targetId: "dashboard-cash",
    where: "Dashboard",
    title: "Tell it your starting cash",
    body: "Deposits and withdrawals go here, so every return is a real percentage of your account.",
  },
  {
    path: "/goals",
    targetId: "tour-goals",
    where: "Goals",
    title: "Commit to something measurable",
    body: "Goals are scored from your trades; nothing is ticked off by hand.",
  },
  {
    path: "/emotions",
    targetId: "emotions-header",
    where: "Emotions",
    title: "How your mood tracks your results",
    body: "Win rate by the emotion you logged before each trade.",
  },
  {
    path: "/fields",
    targetId: "fields-add",
    where: "Fields",
    title: "Track anything the app doesn't",
    body: "Add a field, hide a default, or group trades into folders.",
  },
  {
    path: "/commissions",
    targetId: "commissions-add",
    where: "Commissions",
    title: "Fees, so P/L is always net",
    body: "Tell it your broker's rules once and every trade is charged automatically.",
  },
];

// The paid tour: only what the paid plan unlocks, offered once when an
// account becomes paid and always available from the "?" menu after that.
// Every stop is a panel that switched from an upgrade card to the real thing.
export const PAID_TOUR_STEPS: TourStep[] = [
  {
    path: "/strategies",
    targetId: "tour-scorecards",
    where: "Strategies",
    title: "Scorecards, unlocked",
    body: "Each strategy scored on expectancy, consistency and how closely you follow its own rules.",
  },
  {
    path: "/insights",
    targetId: "tour-edge",
    where: "Insights",
    title: "Find My Edge",
    body: "Your strongest edges and biggest leaks, ranked by expectancy with the trade count behind each.",
  },
  {
    path: "/analytics",
    targetId: "tour-excursion",
    where: "Analytics",
    title: "MAE / MFE",
    body: "Press Calculate once and every trade gets its excursion measured.",
  },
  {
    path: "/analytics",
    targetId: "tour-performance",
    where: "Analytics",
    title: "Performance against account growth",
    body: "Whether the account grew because you traded well or because you deposited.",
  },
  {
    path: "/analytics",
    targetId: "tour-risk",
    where: "Analytics",
    title: "Risk management",
    body: "Position sizing measured against your own median, and when it drifts.",
  },
  {
    path: "/analytics",
    targetId: "tour-drawdown",
    where: "Analytics",
    title: "Drawdown and recovery",
    body: "Every drawdown episode, its depth, length and the climb back.",
  },
  {
    path: "/analytics",
    targetId: "tour-regime",
    where: "Analytics",
    title: "Market conditions",
    body: "How you do in trending, ranging and volatile markets.",
  },
  {
    path: "/reports",
    targetId: "tour-reports",
    where: "Reports",
    title: "Weekly and monthly reports",
    body: "Pick a period and the report writes itself, printable to PDF.",
  },
  {
    path: "/reviews",
    targetId: "tour-reviews",
    where: "AI Reviews",
    title: "AI reviews of your process",
    body: "Bring your own key, and single trades get a review on their page too.",
  },
  {
    path: "/ask",
    targetId: "ask-header",
    where: "Ask",
    title: "Ask your journal",
    body: "Questions answered from your own trades. Add your AI key here first.",
  },
];

export type TourName = "basics" | "features" | "paid";

export const TOURS: Record<TourName, TourStep[]> = {
  basics: TOUR_STEPS,
  features: FEATURE_TOUR_STEPS,
  paid: PAID_TOUR_STEPS,
};

export function isTourName(value: unknown): value is TourName {
  return value === "basics" || value === "features" || value === "paid";
}

/** Whether a step belongs on this route. Route-less steps belong anywhere. */
export function stepMatchesPath(step: TourStep, pathname: string): boolean {
  if (step.pathPrefix) return pathname.startsWith(step.pathPrefix);
  if (step.path) return pathname === step.path;
  return true;
}
