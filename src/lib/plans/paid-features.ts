// What the paid plan holds, and what stays free -- one list, read by the
// public /paid-plan page and the in-app Plans panel, so the two can never
// describe different products.
//
// **Every paid entry maps to a real gate in the code.** /reviews, /reports
// and /ask check isPaidUser and redirect; Find My Edge, the strategy
// scorecards, the trade review and the performance, excursion, risk, regime
// and drawdown panels render an upsell in place of the panel. Nothing here is
// aspirational, and a feature that does not ship does not appear.
//
// No price appears anywhere: billing is not live, and a figure printed before
// it is real is the kind of detail people remember being wrong about.

export type PaidFeatureId =
  | "edge"
  | "excursions"
  | "scorecards"
  | "analysis-panels"
  | "trade-review"
  | "period-review"
  | "ask"
  | "reports";

export interface PaidFeature {
  id: PaidFeatureId;
  /** One line for the in-app Plans panel. A short form of `what`: never a
   *  claim `what` doesn't make. */
  pitch: string;
  name: string;
  where: string;
  what: string;
  how: string;
  use: string;
}

export const PAID_GROUPS: { group: string; blurb: string; features: PaidFeature[] }[] = [
  {
    group: "Reading your own history",
    blurb:
      "The free plan records what happened. These four read it back and tell you which parts of your trading are carrying the account.",
    features: [
      {
        id: "edge",
        pitch: "Your trades cut every way, ranked by what actually pays.",
        name: "Find My Edge",
        where: "Insights",
        what: "Every way of cutting your closed trades, ranked by expectancy rather than win rate.",
        how: "Each trade is grouped by setup, instrument, day, holding period, emotion and exit behaviour. Every group is scored on average R and compared against your own overall average, so the ranking is relative to you rather than to some general benchmark. Groups below a minimum sample are held back instead of shown, because a segment built on four trades is noise.",
        use: "Open it after a month or two of trading. Read the leaks before the edges: cutting the worst segment usually moves the curve further than doing more of the best one.",
      },
      {
        id: "excursions",
        pitch: "How far each trade went against you, and how much of the move you kept.",
        name: "MAE / MFE",
        where: "Analysis",
        what: "How far each trade went against you after entry, and how far it ran in your favour before you closed it.",
        how: "Prices between your entry and exit are measured to find the worst and best points the trade reached, then expressed both as a percentage and in R. The capture figure is the share of the favourable move you actually kept.",
        use: "A high adverse excursion on trades that still won means your stop is sitting further away than it needs to. A low capture rate means you are leaving the back half of your moves behind.",
      },
      {
        id: "scorecards",
        pitch: "Every strategy scored on its own, side by side.",
        name: "Strategy scorecards",
        where: "Strategies",
        what: "Each strategy scored on its own, side by side.",
        how: "Trades are grouped by the strategy they are tagged with, then scored on the same measures the rest of the app uses, so the numbers agree with what you see elsewhere.",
        use: "Run it when you are deciding which setup to drop. It answers which strategy is worth the screen time, rather than which one you enjoy trading.",
      },
      {
        id: "analysis-panels",
        pitch: "Risk, market conditions, drawdowns and performance over time.",
        name: "Risk, regime, drawdown and performance panels",
        where: "Analysis",
        what: "Four deeper reads: how much you risk and when, how you do in different market conditions, how deep your drawdowns go and how long the climb back takes, and how performance moves over time.",
        how: "All four are built from the same stats engine the free analytics use, so a figure here never disagrees with a figure there.",
        use: "These are the monthly-review panels rather than the daily ones. Most people open them once a month, not once a session.",
      },
    ],
  },
  {
    group: "AI that runs on your key",
    blurb:
      "Every AI feature uses an API key you provide. The app never holds a usable key of its own, which is worth understanding before you decide how you feel about AI touching your trading data.",
    features: [
      {
        id: "trade-review",
        pitch: "Each closed trade scored on how you traded it, not on whether it won.",
        name: "AI trade review",
        where: "Reviews",
        what: "Any closed trade scored on how you traded it rather than on whether it won.",
        how: "The trade, your plan rules and your own history are sent to the provider you configured. The score separates execution from outcome, so a winner you fumbled can still come back marked down, and a loss where you followed your plan exactly does not.",
        use: "Review the trades that felt worst, not the ones that lost most. Those are usually different trades, and the gap between them is the useful part.",
      },
      {
        id: "period-review",
        pitch: "Your week or month: the biggest edge, the biggest leak, three priorities.",
        name: "AI period review",
        where: "Reviews",
        what: "Your week or month summarised: the biggest edge, the biggest leak, and three priorities.",
        how: "The period's trades and your own statistics are summarised and sent to your provider, which returns a written read rather than another table.",
        use: "Run it on a Friday. It is the fastest way to end a week with a short list of what to change instead of a vague sense that something is off.",
      },
      {
        id: "ask",
        pitch: "Questions about your own journal, answered from your trades.",
        name: "Ask",
        where: "AI",
        what: "A question box over your own journal.",
        how: "Your question and the relevant slice of your trading data go to your configured provider. Bring a key from any supported provider; free tiers are usually enough.",
        use: "Best for questions a table cannot answer in one look, such as how a setup behaves when you are already down on the day.",
      },
    ],
  },
  {
    group: "Taking it with you",
    blurb: "For the parts of reviewing that happen away from the screen.",
    features: [
      {
        id: "reports",
        pitch: "Your month as a report, laid out to print.",
        name: "Printable reports",
        where: "Reports",
        what: "Your month as a document, laid out to print.",
        how: "The report is rendered as a real page with print styles, so your browser's Save as PDF produces something readable rather than a screenshot of an app.",
        use: "Useful if you review on paper, keep records for tax, or send a monthly summary to someone who coaches you.",
      },
    ],
  },
];

export const PAID_FEATURES: PaidFeature[] = PAID_GROUPS.flatMap((g) => g.features);

/** The free plan, short form. A complete journal, not a trial. */
export const FREE_FEATURES = [
  "Unlimited trades",
  "Equity curve & drawdown",
  "Win rate, profit factor, expectancy",
  "Trading rules & mistake tracking",
  "Goals, imports, exports",
  "Edit history on every trade",
];
