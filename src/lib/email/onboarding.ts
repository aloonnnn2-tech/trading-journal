import { SITE_URL } from "@/lib/site";

/**
 * The two onboarding emails (2026-11-20): a day-0 welcome that points at
 * screenshot import, and a day-2 nudge for accounts that still have no trade
 * of their own. Plain text, written as one person to another, signed without
 * a name (the founder asked for none).
 *
 * Pure: the cron route (src/app/api/cron/onboarding-emails) feeds in each
 * account and sends whatever `pickOnboardingEmail` returns.
 */

export type OnboardingEmailKind = "welcome" | "nudge";

export interface OnboardingEmail {
  subject: string;
  text: string;
}

const DASHBOARD_URL = `${SITE_URL}/dashboard`;

function footer(unsubscribeUrl: string): string {
  return `\n\n--\nDon't want these emails? ${unsubscribeUrl}`;
}

export function onboardingEmail(kind: OnboardingEmailKind, unsubscribeUrl: string): OnboardingEmail {
  if (kind === "welcome") {
    return {
      subject: "Your first trade takes about 30 seconds",
      text:
        `Hey,\n\n` +
        `Thanks for signing up for Trading Lenz.\n\n` +
        `The quickest way to start: take a screenshot of a trade in your broker app and drop it in. ` +
        `Trading Lenz reads the ticker and prices for you, so you just check them and save.\n\n` +
        `${DASHBOARD_URL}\n\n` +
        `If anything is confusing, just reply. I read every email myself.\n\n` +
        `- The founder of Trading Lenz` +
        footer(unsubscribeUrl),
    };
  }
  return {
    subject: "Did something get in the way?",
    text:
      `Hey,\n\n` +
      `Looks like you haven't logged a trade in Trading Lenz yet. No pressure, I just wanted to check nothing got in the way.\n\n` +
      `If you have one recent trade, screenshot it in your broker app and drop it in. That's all it takes.\n\n` +
      `${DASHBOARD_URL}\n\n` +
      `If something didn't work or felt off, hit reply and tell me. Honest feedback helps a lot.\n\n` +
      `- The founder of Trading Lenz` +
      footer(unsubscribeUrl),
  };
}

/** What the sender has recorded on the account (auth app_metadata). */
export interface OnboardingEmailState {
  welcomeSentAt?: string | null;
  nudgeSentAt?: string | null;
  optedOut?: boolean;
}

export interface OnboardingCandidate {
  createdAt: string;
  /** Null until the address is confirmed; nothing is sent before that. */
  emailConfirmedAt: string | null;
  state: OnboardingEmailState;
  /** Test/demo/owner accounts (excluded from analytics) get nothing. */
  excluded: boolean;
}

const HOUR = 60 * 60 * 1000;
/** The welcome goes out only to accounts made in the last day. Anything
 *  older predates this sender and never gets a late "welcome". */
export const WELCOME_WINDOW_MS = 24 * HOUR;
/** The nudge is "day 2": at least 48h after sign-up... */
export const NUDGE_AFTER_MS = 48 * HOUR;
/** ...at least a day after the welcome, so the two never arrive together... */
export const NUDGE_GAP_AFTER_WELCOME_MS = 24 * HOUR;
/** ...and not once the account is a week old (a missed run never sends it late). */
export const NUDGE_UNTIL_MS = 7 * 24 * HOUR;

/**
 * Which email, if any, this account is due. The nudge depends on whether the
 * account has logged a trade of its own, which costs a query, so it comes back
 * as "nudge-if-no-trade" and the caller checks only those accounts.
 */
export function pickOnboardingEmail(
  c: OnboardingCandidate,
  now: Date,
): OnboardingEmailKind | "nudge-if-no-trade" | null {
  if (c.excluded || c.state.optedOut || !c.emailConfirmedAt) return null;
  const age = now.getTime() - new Date(c.createdAt).getTime();
  if (!Number.isFinite(age) || age < 0) return null;

  if (!c.state.welcomeSentAt) {
    return age <= WELCOME_WINDOW_MS ? "welcome" : null;
  }
  if (c.state.nudgeSentAt) return null;
  const sinceWelcome = now.getTime() - new Date(c.state.welcomeSentAt).getTime();
  if (age >= NUDGE_AFTER_MS && age <= NUDGE_UNTIL_MS && sinceWelcome >= NUDGE_GAP_AFTER_WELCOME_MS) {
    return "nudge-if-no-trade";
  }
  return null;
}

/** Reads the sender's record off an account's app_metadata. */
export function readOnboardingState(appMetadata: unknown): OnboardingEmailState {
  const meta = (appMetadata ?? {}) as Record<string, unknown>;
  const raw = meta.onboarding_emails;
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    welcomeSentAt: typeof o.welcome_sent_at === "string" ? o.welcome_sent_at : null,
    nudgeSentAt: typeof o.nudge_sent_at === "string" ? o.nudge_sent_at : null,
    optedOut: o.opted_out === true,
  };
}

/** The app_metadata value to write back after a send or an opt-out. */
export function writeOnboardingState(s: OnboardingEmailState): { onboarding_emails: Record<string, string | boolean> } {
  const out: Record<string, string | boolean> = {};
  if (s.welcomeSentAt) out.welcome_sent_at = s.welcomeSentAt;
  if (s.nudgeSentAt) out.nudge_sent_at = s.nudgeSentAt;
  if (s.optedOut) out.opted_out = true;
  return { onboarding_emails: out };
}
