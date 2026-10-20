// The help form (/help) and its admin page (/admin/help), 2026-10-20.

/**
 * Where people can write instead of using the form. The help page, the
 * contact page and the sign-in page all read it, so a new address is this
 * one line.
 */
export const HELP_EMAIL = "TradingLenzSupport@proton.me";

export const HELP_TOPICS = [
  { id: "account", label: "Account or sign-in" },
  { id: "bug", label: "Something isn't working" },
  { id: "feature", label: "Question about a feature" },
  { id: "paid_plan", label: "Paid plan" },
  { id: "other", label: "Other" },
] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number]["id"];

export const HELP_STATUSES = ["open", "answered", "closed"] as const;
export type HelpStatus = (typeof HELP_STATUSES)[number];

export function topicLabel(id: string): string {
  return HELP_TOPICS.find((t) => t.id === id)?.label ?? "Other";
}

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 4000;
export const NAME_MAX = 80;

/**
 * A field real people never see (hidden from view and from screen readers).
 * Bots that fill every input fill it; the route then answers "sent" and
 * stores nothing, so the bot learns nothing.
 */
export const HONEYPOT_FIELD = "website";

/** Cloudflare Turnstile `action`: a token made for another form is refused. */
export const HELP_CAPTCHA_ACTION = "help";

/**
 * How much the form takes. Real use is a handful a week; these only bite a
 * script. The daily ceiling is for the whole site, so many IPs together
 * still can't flood the table.
 */
export const HELP_LIMITS = {
  perIpPerHour: 5,
  perEmailPerHour: 3,
  perAccountPerDay: 10,
  sitePerDay: 200,
} as const;
