// The example rules on /trading-rules-examples.
//
// `checksWith` names the plan-rule subject (src/lib/plan-rules/subjects.ts)
// that lets Trading Lens check the rule on every trade, and the page badges
// those rules "Trading Lens checks this automatically". It is a claim, so it
// sits under a test (trading-rules.test.ts) that fails if a key isn't a real
// subject. A rule without the key gets no badge; leave it off unless the
// app can genuinely evaluate the rule as written.

export interface ExampleRule {
  text: string;
  why: string;
  checksWith?: string;
}

export interface RuleGroup {
  id: string;
  heading: string;
  intro: string;
  rules: ExampleRule[];
}

export const RULE_GROUPS: RuleGroup[] = [
  {
    id: "risk",
    heading: "Risk rules",
    intro: "These decide how much one trade, one day or one bad streak can cost you.",
    rules: [
      {
        text: "Risk no more than 1% of my account on any single trade.",
        why: "One loss stays small, and even ten in a row leaves most of the account intact.",
        checksWith: "risk_percent",
      },
      {
        text: "Every trade has a stop loss before I enter.",
        why: "A trade without a stop has no defined risk, so it can't be sized or judged.",
        checksWith: "stop_loss",
      },
      {
        text: "Never risk more than $100 on a single trade.",
        why: "A fixed dollar cap is easy to check at a glance. Set it to your own 1%.",
        checksWith: "risk_amount",
      },
      {
        text: "Never let a single loss grow past $150.",
        why: "Gaps and slipped stops happen. This catches the trades where the loss got away from the plan.",
        checksWith: "dollar_pl",
      },
      {
        text: "Keep any one position under $2,500 in size.",
        why: "Caps concentration, so one stock gapping hard can't sink the account.",
        checksWith: "position_size",
      },
      {
        text: "Stop trading for the day after losing 3R.",
        why: "Losses cluster, and decisions get worse after them. The day is over, not the account.",
      },
      {
        text: "No more than five open positions at once.",
        why: "Positions in the same market tend to move together, so more of them is less diversified than it looks.",
      },
    ],
  },
  {
    id: "entry",
    heading: "Entry rules",
    intro: "These keep you to the trades your plan is actually built for.",
    rules: [
      {
        text: "Only take trades with a planned reward : risk of at least 2 : 1.",
        why: "At 2 : 1 you break even winning one trade in three, which leaves room for mistakes.",
        checksWith: "risk_reward_ratio",
      },
      {
        text: "Every trade has a written target before I enter.",
        why: "Without a target there is no reward : risk to judge the trade by, and exits become guesses.",
        checksWith: "take_profit",
      },
      {
        text: "Only trade stocks priced at $5 or more.",
        why: "Very low-priced stocks tend to have wider spreads and wilder moves than a plan expects.",
        checksWith: "entry_price",
      },
      {
        text: "Only take setups that are written in my trading plan.",
        why: "A setup you can't name is a setup you can't review, so it can never improve.",
      },
      {
        text: "No new entries in the first 15 minutes after the open.",
        why: "The open is the noisiest part of the day, and the first move often reverses.",
      },
      {
        text: "Don't hold through an earnings report unless the plan says so.",
        why: "Earnings can gap a stock straight past your stop, so the risk you planned isn't the risk you have.",
      },
      {
        text: "Trade in the direction of the broader market unless the setup says otherwise.",
        why: "Most stocks move with the market, so a long in a falling market starts with the wind against it.",
      },
    ],
  },
  {
    id: "exit",
    heading: "Exit rules",
    intro: "These decide how a trade ends, before emotions get a vote.",
    rules: [
      {
        text: "Don't move my target once the trade is open.",
        why: "Moving the target mid-trade is usually hope or fear, not new information.",
        checksWith: "target_moved",
      },
      {
        text: "Hold a swing trade for no more than 10 days.",
        why: "Time is a cost too. A trade still going nowhere after ten days ties up risk you could use elsewhere.",
        checksWith: "holding_days",
      },
      {
        text: "Once I'm in, the stop only moves to lock in profit, never further away.",
        why: "Widening a stop turns a planned small loss into an unplanned big one.",
      },
      {
        text: "When the stop is hit, I'm out. No waiting for a bounce.",
        why: "The stop is where the idea was proven wrong. Waiting means trading a different idea.",
      },
      {
        text: "Never let a trade that reached +2R turn into a loss.",
        why: "Protects the trades that worked, and keeps a good trade from becoming a lesson in regret.",
      },
    ],
  },
  {
    id: "management",
    heading: "Position management rules",
    intro: "These cover what happens between entry and exit.",
    rules: [
      {
        text: "Never add to a losing position.",
        why: "Averaging down raises your risk exactly when the market is saying you're wrong.",
      },
      {
        text: "Only add to a winner after it has moved 1R my way, and raise the stop when I do.",
        why: "Adds to what is working while keeping the total risk on the trade the same or lower.",
      },
      {
        text: "If I sell part at the first target, the stop on the rest moves to break-even.",
        why: "Banks some profit and makes the remaining shares a free trade.",
      },
    ],
  },
  {
    id: "routine",
    heading: "Routine rules",
    intro: "These make the good habits automatic.",
    rules: [
      {
        text: "Write the trade plan (entry, stop, target, size, reason) before placing the order.",
        why: "A plan written after the trade is a story, not a plan.",
      },
      {
        text: "Log every trade in my journal the same day.",
        why: "Details and feelings fade fast. Same-day notes are the honest ones.",
      },
      {
        text: "Review the week every weekend: total R, mistakes and rules broken.",
        why: "Single trades are noise. Patterns only show up when you look across many.",
      },
      {
        text: "Do my market prep before the open, not during it.",
        why: "Decisions made with a plan beat decisions made while price is moving.",
      },
    ],
  },
  {
    id: "mindset",
    heading: "Mindset rules",
    intro: "These protect you from yourself on the bad days.",
    rules: [
      {
        text: "No trading when I'm tired, angry or rushed.",
        why: "Your rules are only as good as the state you're in when you follow them.",
      },
      {
        text: "After two losses in a row, take a break before the next trade.",
        why: "Breaks the urge to win it back straight away.",
      },
      {
        text: "Never enter a trade to make back a loss.",
        why: "Revenge trades are sized and timed by emotion, not by the setup.",
      },
      {
        text: "If I'm not sure, the answer is no.",
        why: "There is always another trade. A missed trade costs nothing.",
      },
      {
        text: "Never take a trade just because someone else posted it.",
        why: "You don't know their stop, their size or their exit, so you can't manage it.",
      },
    ],
  },
];

/** Every rule as plain text, grouped, for the "Copy all" button. */
export function rulesAsText(groups: RuleGroup[] = RULE_GROUPS): string {
  return groups
    .map((g) => [g.heading.toUpperCase(), ...g.rules.map((r) => `- ${r.text}`)].join("\n"))
    .join("\n\n");
}
