import type { ReviewSource } from "./types";

// When to ask for a review (Alon, 2026-10-11): after the 5th closed trade,
// after a "wow" moment (first screenshot import, first AI review), or after
// two weeks of regular use. Pure, so the rules are tested rather than hoped.
//
// Asking is a favour, so it errs toward leaving people alone: never twice
// in a session, "Not now" means 30 days, "Don't ask again" means never, and
// at most three asks in all -- and never over the tour or a dialog.

export const SNOOZE_DAYS = 30;
export const MAX_ASKS = 3;
export const CLOSED_TRADES_TRIGGER = 5;
export const TWO_WEEKS_DAYS = 14;
export const TWO_WEEKS_VISITS = 5;

const DAY = 24 * 60 * 60 * 1000;

export interface PromptFacts {
  hasReview: boolean;
  dismissed: boolean;
  /** ISO string or null. */
  snoozedUntil: string | null;
  timesAsked: number;
  closedTrades: number;
  /** ISO string of the account's creation. */
  accountCreatedAt: string | null;
  visits: number;
}

/** Why to ask now, or null. The server decides from the database; the
 *  "wow" moments are added by the client right after they happen. */
export function reviewTrigger(f: PromptFacts, now: number = Date.now()): ReviewSource | null {
  if (!mayAsk(f, now)) return null;
  if (f.closedTrades >= CLOSED_TRADES_TRIGGER) return "closed_trades";
  const created = f.accountCreatedAt ? Date.parse(f.accountCreatedAt) : NaN;
  if (Number.isFinite(created) && now - created >= TWO_WEEKS_DAYS * DAY && f.visits >= TWO_WEEKS_VISITS) return "two_weeks";
  return null;
}

/** The limits every ask obeys, whatever triggered it. */
export function mayAsk(f: Pick<PromptFacts, "hasReview" | "dismissed" | "snoozedUntil" | "timesAsked">, now: number = Date.now()): boolean {
  if (f.hasReview || f.dismissed) return false;
  if (f.timesAsked >= MAX_ASKS) return false;
  if (f.snoozedUntil) {
    const until = Date.parse(f.snoozedUntil);
    // Unreadable: leave the person alone rather than nag.
    if (Number.isNaN(until) || now < until) return false;
  }
  return true;
}

export function snoozeUntil(now: number = Date.now()): string {
  return new Date(now + SNOOZE_DAYS * DAY).toISOString();
}

/** Pages where a corner card is welcome: overviews, not forms. */
export function isPromptPage(pathname: string): boolean {
  return pathname === "/dashboard" || pathname === "/trades" || /^\/trades\/[0-9a-f-]{36}$/.test(pathname);
}
