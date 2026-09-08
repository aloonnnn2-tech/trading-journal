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

// ---------------------------------------------------------------------------
// The second tour.
//
// Everything above walks a brand-new account through logging one trade. This
// one covers what the app grew afterwards -- rules, mistakes, edges, goals,
// reports, reviews -- and is deliberately NOT bolted onto the end of signup:
// every screen it visits is empty until there are closed trades in the
// journal, so on day one it would be a tour of empty boxes. It is offered
// from the "?" menu instead, where someone can take it when they have data.
//
// The anchors are the collapsible sections rather than the panels inside
// them, so a step lands in the same place whether the panel is collapsed,
// expanded, or showing an upgrade card -- which also means no step has to be
// hidden from free users. Meeting the upgrade card mid-tour, in context, is a
// better explanation of the paid plan than a pricing page anyway.
export const FEATURE_TOUR_STEPS: TourStep[] = [
  {
    path: "/strategies",
    targetId: "strategies-add",
    title: "Name the setups you trade",
    body: "A strategy is just a name for how you took the trade. Attach rules to it — 'stop must be set', 'risk under 1%' — and every trade tagged with it gets graded against them automatically.",
  },
  {
    path: "/strategies",
    targetId: "tour-scorecards",
    title: "Which setups actually work",
    body: "Each strategy scored on expectancy, consistency, and how closely you follow its own rules. A strategy needs a handful of trades before it appears — five trades is a coincidence, not a track record.",
  },
  {
    path: "/insights",
    targetId: "tour-mistakes",
    title: "What keeps costing you",
    body: "Mistakes come from three places: ones the app spots on its own, rules you broke, and tags you added yourself. It shows how often each happens and what those trades returned — with both sample sizes, so you can judge whether the difference means anything.",
  },
  {
    path: "/insights",
    targetId: "tour-edge",
    title: "Where your edge actually is",
    body: "Every way of slicing your journal — setup, ticker, direction, day, hold time, mood — ranked by expectancy rather than win rate. Winning often for very little is worse than winning rarely for a lot.",
  },
  {
    path: "/analytics",
    targetId: "tour-risk",
    title: "How you size, and when that slips",
    body: "Whether you risk the same amount every time, and whether it creeps up after a loss or during a drawdown. Measured against your own median — there is no correct risk percentage, only yours and how consistent it is.",
  },
  {
    path: "/analytics",
    targetId: "tour-drawdown",
    title: "Every drawdown, not just the worst",
    body: "How deep each one went, how long it lasted, and how many trades it took to climb back — so you can tell whether the one you are in now is normal for you or genuinely unusual.",
  },
  {
    path: "/goals",
    targetId: "tour-goals",
    title: "Commit to something measurable",
    body: "Goals are scored from your actual trades — nothing is ticked off by hand. 'Risk under 1% on every trade' or 'no more than two revenge trades this month' fill in as you go.",
  },
  {
    path: "/reports",
    targetId: "tour-reports",
    title: "Your month as a document",
    body: "Best and worst strategy, biggest mistake, best and worst trade, drawdown and risk — assembled from the numbers you have already seen, and printable to PDF.",
  },
  {
    path: "/reviews",
    targetId: "tour-reviews",
    title: "Have your process critiqued",
    body: "Bring your own AI key — free options work — and get your week or month reviewed on execution rather than on whether it made money. Every number is computed by the app; the model only explains it. That is the end of the tour.",
  },
];

export type TourName = "basics" | "features";

export const TOURS: Record<TourName, TourStep[]> = {
  basics: TOUR_STEPS,
  features: FEATURE_TOUR_STEPS,
};
