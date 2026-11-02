// The free public tools: pages found through search that work without an
// account and lead to sign-up. One list, read by PUBLIC_PATHS, the sitemap,
// the footer, the /free-tools hub and each page's "More free tools" row, so a
// new tool is one entry here plus its page.

export interface FreeTool {
  path: string;
  /** Card and link text. */
  name: string;
  /** One sentence for the hub and "More free tools" cards. */
  blurb: string;
  kind: "Calculator" | "Guide" | "Template";
  /** Listed in the landing page footer. The rest are reached via the hub. */
  inFooter: boolean;
}

export const FREE_TOOLS: FreeTool[] = [
  {
    path: "/position-size-calculator",
    name: "Position size calculator",
    blurb: "How many shares to buy so a stopped-out trade loses exactly what you planned.",
    kind: "Calculator",
    inFooter: true,
  },
  {
    path: "/risk-reward-calculator",
    name: "Risk/reward calculator",
    blurb: "Your reward-to-risk ratio and the win rate you need to break even at it.",
    kind: "Calculator",
    inFooter: true,
  },
  {
    path: "/trading-checklist",
    name: "Pre-trade checklist",
    blurb: "Twelve questions to answer before every entry. Tick them off, or print it.",
    kind: "Template",
    inFooter: true,
  },
  {
    path: "/trading-rules-examples",
    name: "Trading rules examples",
    blurb: "Example rules for risk, entries, exits and mindset, ready to copy.",
    kind: "Guide",
    inFooter: true,
  },
  {
    path: "/trading-plan-template",
    name: "Trading plan template",
    blurb: "Fill in a few boxes and get a one-page trading plan to print or copy.",
    kind: "Template",
    inFooter: false,
  },
  {
    path: "/what-is-an-r-multiple",
    name: "What is an R multiple?",
    blurb: "The unit that makes every trade comparable, with worked examples.",
    kind: "Guide",
    inFooter: false,
  },
  {
    path: "/how-to-journal-a-swing-trade",
    name: "How to journal a swing trade",
    blurb: "What to write before, during and after a trade, with a free template.",
    kind: "Guide",
    inFooter: false,
  },
];

export const FREE_TOOLS_HUB = "/free-tools";

export const FREE_TOOL_PATHS = [FREE_TOOLS_HUB, ...FREE_TOOLS.map((t) => t.path)];
