// The app's top menu, as data. The nav bar renders it; the guided tour reads
// it to point a user at the right menu item rather than moving them itself
// (see src/lib/tour/nav-target.ts). One list, so the two can't disagree.
//
// Twelve flat links became six top-level items. The old list was every page
// in the app, side by side, in the order they happened to be built -- so
// Goals, Reports and AI Reviews arrived as equal peers to Commissions, and a
// new user met twelve choices before doing anything. These three stay direct
// because they are the daily path; the rest group by the question they answer.

export interface NavLink {
  href: string;
  label: string;
  /** Shown under the label in a dropdown, so a group is browsable without
   *  having to already know what each page is. */
  hint?: string;
}

export const PRIMARY_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trades", label: "Trades" },
  { href: "/strategies", label: "Strategies" },
];

export const NAV_GROUPS: { label: string; links: NavLink[] }[] = [
  {
    label: "Analysis",
    links: [
      { href: "/analytics", label: "Analytics", hint: "Equity, drawdown, risk, market conditions" },
      { href: "/insights", label: "Insights", hint: "Patterns and recurring mistakes" },
      { href: "/goals", label: "Goals", hint: "Commitments scored from your trades" },
      { href: "/reports", label: "Reports", hint: "A printable weekly or monthly summary" },
      { href: "/emotions", label: "Emotions", hint: "How your mood tracks your results" },
    ],
  },
  {
    label: "AI",
    links: [
      { href: "/ask", label: "Ask", hint: "Questions about your own journal" },
      { href: "/reviews", label: "AI Reviews", hint: "Your week or month, critiqued" },
    ],
  },
  {
    label: "Setup",
    links: [
      { href: "/fields", label: "Fields", hint: "Track anything the app doesn't already" },
      { href: "/commissions", label: "Commissions", hint: "Broker fees, so P/L is always net" },
      { href: "/settings", label: "Settings", hint: "Choose what the app shows you" },
    ],
  },
];

/**
 * The group that folds into the account menu below the nav breakpoint
 * (1000px), where the bar has no room for it. The nav bar renders it there,
 * and the tour points at the account button to reach it.
 */
export const ACCOUNT_MENU_GROUP = "Setup";

/** The data-tour-id a menu link carries: `nav-insights` for /insights. */
export function navLinkTourId(href: string): string {
  return `nav-${href.slice(1)}`;
}

/** The data-tour-id a dropdown's button carries: `nav-group-analysis`. */
export function navGroupTourId(label: string): string {
  return `nav-group-${label.toLowerCase()}`;
}
