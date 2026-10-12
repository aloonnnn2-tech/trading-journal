import { REVIEW_SOURCES, SOURCE_LABELS } from "@/lib/reviews/types";
import { z } from "zod";
import { NAV_GROUPS, PRIMARY_LINKS, navGroupTourId, navLinkTourId } from "@/lib/nav/links";

/**
 * THE list of analytics events (Problem 1 of the hardening brief).
 *
 * One source of truth for the client tracker, the API route and the admin
 * screens: an event's name, its props shape, its category, and the plain
 * sentence the admin feed shows for it. How to add an event:
 * docs/analytics-events.md.
 *
 * - The browser can only send CLIENT_EVENTS, and the track route validates
 *   each one against its props schema. Unknown names or shapes are refused
 *   and counted, so the table can't fill with events nobody can read.
 * - Server routes log SERVER_EVENTS through logEvent(), whose name parameter
 *   is typed to this list: an unlisted name is a compile error.
 * - The admin screens render every row, old or new, through describeEvent().
 *   It never returns an empty sentence; anything unrecognised is
 *   "Unknown event (raw: ...)" and flagged so the UI can count it.
 *
 * Privacy: props are paths, ids, enums, counts and button names only. Never
 * typed text, trade values or notes (see the label rule in click-capture.ts).
 */

export type EventCategory = "navigation" | "click" | "session" | "tour" | "trades" | "ai" | "data" | "account" | "feedback";

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  navigation: "Pages",
  click: "Clicks",
  session: "Sessions",
  tour: "Tours",
  trades: "Trades",
  ai: "AI",
  data: "Import / export",
  account: "Account",
  feedback: "Reviews",
};

// ---------------------------------------------------------------- pages ---

const NAV_PAGES: Record<string, string> = Object.fromEntries(
  [...PRIMARY_LINKS, ...NAV_GROUPS.flatMap((g) => g.links)].map((l) => [l.href, l.label]),
);

const OTHER_PAGES: Record<string, string> = {
  "/account": "Account",
  "/trades/import": "Import",
  "/admin/analytics": "Admin: Analytics",
  "/admin/activity": "Admin: Activity",
  "/admin/users": "Admin: Users",
  "/admin/plans": "Admin: Plans",
  "/admin/waitlist": "Admin: Waitlist",
};

/** A page path as a person would name it. Never empty. */
export function pageName(path: unknown): string {
  if (typeof path !== "string" || path === "") return "an unknown page";
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (NAV_PAGES[clean]) return NAV_PAGES[clean];
  if (OTHER_PAGES[clean]) return OTHER_PAGES[clean];
  if (/^\/trades\/[^/]+$/.test(clean)) return "a trade";
  if (/^\/admin\/users\/[^/]+$/.test(clean)) return "Admin: one user";
  if (clean === "/") return "the home page";
  return clean;
}

// --------------------------------------------------------------- clicks ---

/**
 * Click labels (from data-tour-id, data-track, aria-label, or visible text;
 * see deriveLabel in click-capture.ts) -> the sentence the feed shows.
 * src/lib/tracking/events.test.ts fails if any data-tour-id or data-track in
 * the source has no entry here.
 */
export const CLICK_LABELS: Record<string, string> = {
  // Menu, built from the same nav data the menu itself renders.
  ...Object.fromEntries(
    [...PRIMARY_LINKS, ...NAV_GROUPS.flatMap((g) => g.links)].map((l) => [
      navLinkTourId(l.href),
      `Opened **${l.label}** from the menu`,
    ]),
  ),
  ...Object.fromEntries(NAV_GROUPS.map((g) => [navGroupTourId(g.label), `Expanded the **${g.label}** menu`])),
  "nav-account": "Opened the **account** menu",
  "nav-help": "Opened **Help** (the tours)",
  "nav-more": "Opened **More** on the phone tab bar",

  // Dashboard and trades.
  "dashboard-quick-trade": "Clicked **Quick trade**",
  "dashboard-cash": "Opened the **cash** card",
  "trades-search": "Clicked the **trade search** box",
  "trades-screenshot": "Started a **screenshot import**",
  "trades-import": "Opened **Import** from the trade list",
  "trades-export": "Opened **Export** on the trade list",
  "trade-detail-hero": "Clicked the **trade header**",
  "trade-plan-adherence": "Clicked **plan adherence** on a trade",
  "quick-ticker": "Used the **ticker** field in Quick trade",
  "quick-direction": "Chose **long or short** in Quick trade",
  "quick-status": "Chose the **status** in Quick trade",
  "quick-entry": "Used the **entry price** field in Quick trade",
  "quick-stop": "Used the **stop** field in Quick trade",
  "quick-shares": "Used the **shares** field in Quick trade",
  "quick-create": "Created a trade with **Quick trade**",
  "folder tab": "Switched **folder tab** on the trade list",
  "fill-price-save": "Answered **at what price an order filled**",
  "fill-price-keep": "Kept the **assumed fill price** of an order",
  "trade link": "Opened **a trade** from a list",

  // Setup pages.
  "strategies-add": "Clicked **Add strategy**",
  "fields-add": "Clicked **Add field**",
  "fields-remove": "Clicked **Remove field**",
  "commissions-add": "Clicked **Add fee**",

  // AI.
  "ask-submit": "Sent a question in **Ask**",
  "ask-header": "Clicked the **Ask** header",
  "conversation-open": "Opened a **conversation** in Ask",
  "conversation-delete": "Deleted a **conversation** in Ask",

  // Reviews of Trading Lens.
  "review-submit": "Sent or updated their **review** of Trading Lens",
  "review-remove": "Removed their **review** of Trading Lens",
  "review-prompt-not-now": "Said **Not now** to a review request",
  "review-prompt-never": "Said **Don't ask again** to review requests",
  "review-cta": "Clicked **Leave a review** on the homepage",
  "review-cta-floating": "Clicked the floating **Leave a review** button on the homepage",
  "nav-review": "Opened **Rate Trading Lens** from the account menu",

  // Paid plan.
  "see-plans": "Opened **Plans** from a paid feature",
  "plans-details": "Opened **how every paid feature works** from Plans",
  "waitlist-join": "Joined the **paid-plan waitlist**",

  // Section anchors the tours point at; rarely clicked themselves.
  "analytics-header": "Clicked the **Analytics** header",
  "insights-header": "Clicked the **Insights** header",
  "emotions-header": "Clicked the **Emotions** header",
  "tour-performance": "Clicked the **Performance** panel",
  "tour-drawdown": "Clicked the **Drawdown** panel",
  "tour-risk": "Clicked the **Risk** panel",
  "tour-regime": "Clicked the **Market conditions** panel",
  "tour-edge": "Clicked the **Edge** panel",
  "tour-excursion": "Clicked the **Excursions** panel",
  "tour-scorecards": "Clicked the **Strategy scorecards**",
  "tour-mistakes": "Clicked the **Mistakes** panel",
  "tour-goals": "Clicked the **Goals** panel",
  "tour-reports": "Clicked the **Reports** panel",
  "tour-reviews": "Clicked the **AI Reviews** panel",

  // aria-labels a person never sees written down.
  "Close (Esc)": "Closed the **trade panel**",
  "Previous trade (←)": "Went to the **previous trade** in the panel",
  "Next trade (→)": "Went to the **next trade** in the panel",
  "Toggle theme": "Switched **light / dark** theme",
};

/** A label that is a developer id rather than words: `nav-foo`, `ask-submit`. */
export function isIdLikeLabel(label: string): boolean {
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(label);
}

export interface ClickName {
  sentence: string;
  /** False for a developer id the registry doesn't know yet. */
  mapped: boolean;
}

export function clickName(label: unknown): ClickName {
  if (typeof label !== "string" || label.trim() === "") {
    return { sentence: "Clicked an **unlabelled** control", mapped: true };
  }
  const known = CLICK_LABELS[label];
  if (known) return { sentence: known, mapped: true };
  // Visible text and aria-labels are already words a person wrote for a
  // person ("Save fee", "Users"). Quote them rather than invent a name.
  if (!isIdLikeLabel(label)) return { sentence: `Clicked **"${label}"**`, mapped: true };
  return { sentence: `Clicked an unnamed control (raw: ${label})`, mapped: false };
}

// --------------------------------------------------------------- events ---

const PATH = z.string().min(1).max(300).regex(/^\//);
const UUID_LIKE = z.string().max(64);
const TOUR = z.enum(["basics", "features", "paid"]);
const NONE = z.object({}).strict();
const REVIEW_SOURCE = z.enum(REVIEW_SOURCES);
const reviewSourceName = (v: unknown): string =>
  (SOURCE_LABELS as Record<string, string>)[String(v)]?.toLowerCase() ?? "unknown moment";

type Props = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const TOUR_NAMES: Record<string, string> = { basics: "Basics", features: "Features", paid: "Paid plan" };
const tourName = (v: unknown) => TOUR_NAMES[str(v)] ?? (str(v) || "a tour");

interface EventDef {
  category: EventCategory;
  /** Plural noun phrase for count tables: "Trades created". */
  countLabel: string;
  props: z.ZodType;
  sentence: (p: Props) => string;
}

export const CLIENT_EVENTS = {
  session_start: {
    category: "session",
    countLabel: "Sessions started",
    props: NONE,
    sentence: () => "Started a session",
  },
  page_view: {
    category: "navigation",
    countLabel: "Page views",
    props: z.object({ path: PATH }).strict(),
    sentence: (p) => `Opened **${pageName(p.path)}**`,
  },
  page_exit: {
    category: "session",
    countLabel: "Times they left the app",
    props: z.object({ path: PATH }).strict(),
    sentence: (p) => `Left the app on **${pageName(p.path)}** (closed or switched away)`,
  },
  click: {
    category: "click",
    countLabel: "Clicks",
    props: z
      .object({
        label: z.string().max(60).nullable().optional(),
        tag: z.string().max(20),
        path: PATH,
        role: z.string().max(30).optional(),
      })
      .strict(),
    sentence: (p) => `${clickName(p.label).sentence} on **${pageName(p.path)}**`,
  },
  login: { category: "account", countLabel: "Sign-ins", props: NONE, sentence: () => "Signed in" },
  signup_completed: { category: "account", countLabel: "Sign-ups", props: NONE, sentence: () => "Created their account" },
  tour_completed: {
    category: "tour",
    countLabel: "Tours completed",
    props: z.object({ tour: TOUR, steps: z.number().int().min(0).max(100) }).strict(),
    sentence: (p) => `Finished the **${tourName(p.tour)}** tour (${num(p.steps) ?? "?"} steps)`,
  },
  tour_skipped: {
    category: "tour",
    countLabel: "Tours skipped",
    props: z.object({ tour: TOUR, atStep: z.number().int().min(0).max(100) }).strict(),
    sentence: (p) =>
      num(p.atStep) === 0
        ? `Skipped the **${tourName(p.tour)}** tour before starting`
        : `Left the **${tourName(p.tour)}** tour at step ${num(p.atStep) ?? "?"}`,
  },
  review_prompt_shown: {
    category: "feedback",
    countLabel: "Review requests shown",
    props: z.object({ source: REVIEW_SOURCE }).strict(),
    sentence: (p) => `Was asked for a **review** (${reviewSourceName(p.source)})`,
  },
  review_prompt_snoozed: { category: "feedback", countLabel: "Review requests put off", props: NONE, sentence: () => "Said **Not now** to a review request" },
  review_prompt_dismissed: { category: "feedback", countLabel: "Review requests declined", props: NONE, sentence: () => "Said **Don't ask again** to review requests" },
  dashboard_viewed: { category: "navigation", countLabel: "Dashboard views", props: NONE, sentence: () => "Viewed the **Dashboard**" },
  analytics_panel_viewed: { category: "navigation", countLabel: "Analytics views", props: NONE, sentence: () => "Viewed **Analytics**" },
  settings_viewed: { category: "navigation", countLabel: "Settings views", props: NONE, sentence: () => "Viewed **Settings**" },
  commissions_viewed: { category: "navigation", countLabel: "Commissions views", props: NONE, sentence: () => "Viewed **Commissions**" },
} satisfies Record<string, EventDef>;

export const SERVER_EVENTS = {
  review_submitted: {
    category: "feedback",
    countLabel: "Reviews written or edited",
    props: z.object({ rating: z.number().int().min(1).max(5), allowPublic: z.boolean(), source: REVIEW_SOURCE }).strict(),
    sentence: (p) =>
      `Rated Trading Lens **${"★".repeat(num(p.rating) ?? 0) || "?"}**` + (p.allowPublic === true ? " (may be shown publicly)" : ""),
  },
  trade_created: {
    category: "trades",
    countLabel: "Trades created",
    props: z.object({ tradeId: UUID_LIKE, source: z.string().max(20).optional() }),
    sentence: (p) => (str(p.source) === "duplicate" ? "Duplicated **a trade**" : "Created **a trade**"),
  },
  trade_edited: { category: "trades", countLabel: "Trades edited", props: z.object({ tradeId: UUID_LIKE }), sentence: () => "Edited **a trade**" },
  trade_deleted: { category: "trades", countLabel: "Trades deleted", props: z.object({ tradeId: UUID_LIKE }), sentence: () => "Deleted **a trade**" },
  import_used: {
    category: "data",
    countLabel: "Imports",
    props: z.object({ imported: z.number(), errors: z.number() }),
    sentence: (p) =>
      `Imported **${num(p.imported) ?? "?"} trades**` + (num(p.errors) ? ` (${num(p.errors)} rows failed)` : ""),
  },
  export_used: {
    category: "data",
    countLabel: "Exports",
    props: z.object({ format: z.string().max(10) }),
    sentence: (p) => `Exported their trades as **${str(p.format).toUpperCase() || "a file"}**`,
  },
  ai_review_generated: {
    category: "ai",
    countLabel: "AI reviews generated",
    props: z.object({ kind: z.string().max(20) }).passthrough(),
    sentence: (p) =>
      str(p.kind) === "trade"
        ? "Generated an **AI review** of a trade"
        : `Generated an **AI review** of a period${num(p.tradesAnalyzed) ? ` (${num(p.tradesAnalyzed)} trades)` : ""}`,
  },
  ai_question_answered: {
    category: "ai",
    countLabel: "AI questions answered",
    props: z.object({ provider: z.string().max(30), mode: z.string().max(20) }),
    sentence: (p) => `Asked the AI a question${str(p.provider) ? ` (via ${str(p.provider)})` : ""}`,
  },
  ai_key_added: {
    category: "ai",
    countLabel: "AI keys added",
    props: z.object({ provider: z.string().max(30) }),
    sentence: (p) => `Added an **AI key**${str(p.provider) ? ` for ${str(p.provider)}` : ""}`,
  },
  screenshot_parsed: { category: "data", countLabel: "Screenshots read", props: NONE, sentence: () => "Read a **screenshot** for a trade" },
  account_transaction_added: {
    category: "account",
    countLabel: "Cash entries added",
    props: z.object({ transactionId: UUID_LIKE }),
    sentence: () => "Added a **cash entry**",
  },
  account_transaction_deleted: {
    category: "account",
    countLabel: "Cash entries deleted",
    props: z.object({ transactionId: UUID_LIKE }),
    sentence: () => "Deleted a **cash entry**",
  },
  commissions_recalculated: {
    category: "trades",
    countLabel: "Fee recalculations",
    props: z.object({ updated: z.number(), skipped: z.number(), failed: z.number() }),
    sentence: (p) => `Recalculated fees on **${num(p.updated) ?? "?"} trades**`,
  },
} satisfies Record<string, EventDef>;

export type ClientEventName = keyof typeof CLIENT_EVENTS;
export type ServerEventName = keyof typeof SERVER_EVENTS;
export type EventName = ClientEventName | ServerEventName;

const ALL_EVENTS: Record<string, EventDef> = { ...CLIENT_EVENTS, ...SERVER_EVENTS };

export function isClientEventName(name: string): name is ClientEventName {
  return Object.prototype.hasOwnProperty.call(CLIENT_EVENTS, name);
}

/** Validates one browser-sent event against the list. */
export function validateClientEvent(
  name: string,
  props: unknown,
): { ok: true; props: Props } | { ok: false; reason: "unknown_event" | "bad_props" } {
  if (!isClientEventName(name)) return { ok: false, reason: "unknown_event" };
  const parsed = CLIENT_EVENTS[name].props.safeParse(props ?? {});
  if (!parsed.success) return { ok: false, reason: "bad_props" };
  return { ok: true, props: parsed.data as Props };
}

// -------------------------------------------------------------- render ---

export interface DescribedEvent {
  sentence: string;
  category: EventCategory | "unknown";
  /** Page the event happened on, when the event carries one. */
  page: string | null;
  /** Not in the list, or a developer id with no name: the UI counts these. */
  unmapped: boolean;
}

function rawText(name: string, props: Props): string {
  const s = JSON.stringify({ event: name, ...props });
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
}

/** The feed's one sentence for any stored row. Never empty. */
export function describeEvent(eventName: string, props: Props | null | undefined): DescribedEvent {
  const p = props ?? {};
  const def = ALL_EVENTS[eventName];
  if (!def) {
    return { sentence: `Unknown event (raw: ${rawText(eventName || "(no name)", p)})`, category: "unknown", page: null, unmapped: true };
  }
  const sentence = def.sentence(p).trim() || `${def.countLabel} (raw: ${rawText(eventName, p)})`;
  const unmapped = eventName === "click" && !clickName(p.label).mapped;
  const page = typeof p.path === "string" ? pageName(p.path) : null;
  return { sentence, category: def.category, page, unmapped };
}

export function countLabelFor(eventName: string): string {
  return ALL_EVENTS[eventName]?.countLabel ?? `Unknown event "${eventName}"`;
}

export function categoryOf(eventName: string): EventCategory | "unknown" {
  return ALL_EVENTS[eventName]?.category ?? "unknown";
}
