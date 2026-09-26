// Whether to show the paid-plan tour offer right now.
//
// **The bug this exists to prevent.** The offer used to be a single
// localStorage flag, so "Later" and "Show me" did the same thing -- there was
// no way to say "not now" and have it mean not now. Meanwhile the card sat
// bottom-centre over whatever you were reading until you clicked one of them,
// on every page, and a second browser or device had never heard of your
// answer (issue 2 of docs/design-audit.md).
//
// The decision is pure and lives here because it is four overlapping
// conditions and an expiry comparison, which is exactly the shape of thing
// that looks obviously right and is off by one state. The component does the
// I/O; this says yes or no.

/** How long "Later" buys. */
export const SNOOZE_DAYS = 7;
export const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;

export interface PaidOfferState {
  /** Does this account have the paid plan at all? */
  isPaid: boolean;
  /** Finished with: "Show me", or completing the tour. Never unset. */
  dismissed: boolean;
  /** "Later" -- hidden until this passes. Null when never snoozed. An ISO
   *  string, because that is what both the database and localStorage hold. */
  snoozedUntil: string | null;
  /** Already offered once in this browsing session. The spec asks for at most
   *  once per session, so a reload mid-session does not bring it back. */
  seenThisSession: boolean;
}

/**
 * Should the offer card render?
 *
 * @param now Injected rather than read from the clock, so the expiry boundary
 *            is testable without freezing time.
 */
export function shouldShowPaidOffer(state: PaidOfferState, now: number = Date.now()): boolean {
  if (!state.isPaid) return false;
  if (state.dismissed) return false;
  if (state.seenThisSession) return false;

  if (state.snoozedUntil !== null) {
    const until = Date.parse(state.snoozedUntil);
    // An unparseable timestamp is treated as "still snoozed", not as "show
    // it". A corrupt value in storage should fail toward leaving the reader
    // alone -- the offer is a nicety, and showing it wrongly is the more
    // annoying of the two mistakes.
    if (Number.isNaN(until)) return false;
    if (now < until) return false;
  }

  return true;
}

/** The timestamp "Later" should store. */
export function snoozeUntil(now: number = Date.now()): string {
  return new Date(now + SNOOZE_MS).toISOString();
}
