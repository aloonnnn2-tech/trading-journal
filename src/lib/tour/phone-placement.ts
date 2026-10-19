// Where the tour card goes on a phone (below 640px).
//
// It used to be pinned to the bottom of the screen, always -- and on a phone
// almost everything the tour points at opens at the bottom: the tab bar's More
// and + sheets, and the Quick trade form, whose Create trade button sat right
// under the card. The tour asked for a tap on something it was covering, and
// could not go on (Alon, 2026-10-15).
//
// The rule now: the card never sits on its target.
//  - While one of the app's dialogs or sheets is open, the card shrinks to a
//    strip across the top, and the dialog is told to leave room for it (see
//    --tour-top in globals.css). The strip says what to do and nothing more.
//  - Otherwise the card goes to whichever end of the screen -- above the tab
//    bar, or over the top bar -- the target is not at.
//
// Pure, so it can be tested without a DOM.

export interface PhoneRect {
  top: number;
  height: number;
}

export interface PhoneLayout {
  /** The window's height. */
  viewportH: number;
  /** The bottom tab bar's height (0 when there is none). */
  tabBarH: number;
  /** The card's measured height. */
  cardH: number;
  /** The spotlighted target, or null when there is none. */
  target: PhoneRect | null;
  /** One of the app's own dialogs or sheets is open. */
  dialogOpen: boolean;
}

export type PhoneDock = "strip" | "top" | "bottom";

/** Space between the card and the screen edge (or the tab bar). */
export const PHONE_EDGE = 8;
/** The card's ring padding plus a little air, so the ring isn't covered either. */
const RING = 10;

export function phoneDock({ viewportH, tabBarH, cardH, target, dialogOpen }: PhoneLayout): PhoneDock {
  if (dialogOpen) return "strip";
  if (!target) return "bottom";

  const bottomCardTop = viewportH - tabBarH - PHONE_EDGE - cardH;
  const topCardBottom = PHONE_EDGE + cardH;
  const targetTop = target.top - RING;
  const targetBottom = target.top + target.height + RING;

  if (targetBottom <= bottomCardTop) return "bottom";
  if (targetTop >= topCardBottom) return "top";

  // It overlaps either way (a target taller than the room left): cover as
  // little of it as possible.
  const overlapBottom = targetBottom - bottomCardTop;
  const overlapTop = topCardBottom - targetTop;
  return overlapTop < overlapBottom ? "top" : "bottom";
}

/**
 * How far to scroll the page so the target sits where the card is not, or 0
 * when it already does. The card goes to the bottom for a page target, so the
 * target's top edge is brought just under the top bar -- its heading, which
 * says what it is, is then always in view, however tall the panel.
 */
export function phoneScrollDelta(
  target: PhoneRect,
  { viewportH, tabBarH, cardH, headerH }: { viewportH: number; tabBarH: number; cardH: number; headerH: number },
): number {
  const freeTop = headerH + RING + PHONE_EDGE;
  const freeBottom = viewportH - tabBarH - PHONE_EDGE - cardH - RING;
  const fits = target.top >= freeTop && target.top + target.height <= freeBottom;
  if (fits) return 0;
  return target.top - freeTop;
}
