// Whether a given element should animate in at all, and when it is due.
//
// **The bug this exists to prevent.** Every reveal on this site used to render
// `opacity: 0` into the server HTML and wait for `whileInView` to fire 60px
// AFTER the element crossed the viewport edge. So the page arrived blank,
// hydrated, and then filled in -- and while scrolling, a section you were
// already looking at stayed empty for the better part of a second. The audit
// called it out twice (issues 7 and 4).
//
// The rule now: content is visible in the server HTML, full stop. Motion is
// applied afterwards, by the client, and ONLY to elements that are far enough
// below the fold that nobody can see them being hidden. Anything already on
// screen -- or about to be -- is simply left alone and never animates.
//
// Split out from the component so it can be tested: the decision is the part
// that is easy to get subtly wrong, and vitest here is node-only with no DOM
// rendering.

/** How far past the bottom of the viewport the reveal band extends, as a
 *  fraction of viewport height. An element inside this band is treated as
 *  "about to be seen": it is shown outright rather than animated, so it can
 *  never be caught mid-fade, and an element below it starts animating before
 *  it reaches the edge rather than after. */
export const REVEAL_MARGIN_RATIO = 0.2;

/**
 * The viewport-relative y below which an element is not yet due to be shown.
 */
export function revealLimit(viewportHeight: number, marginRatio: number = REVEAL_MARGIN_RATIO): number {
  return viewportHeight * (1 + marginRatio);
}

/**
 * Should this element start hidden and animate in?
 *
 * True only when the element's top edge sits below the reveal band, i.e. it is
 * comfortably off screen. Everything else -- on screen, partly on screen, in
 * the band, or scrolled past above -- returns false and renders as-is.
 *
 * @param elementTop   `getBoundingClientRect().top`: viewport-relative, so
 *                     negative once the element is above the fold.
 * @param viewportHeight `window.innerHeight`.
 */
export function shouldStartHidden(
  elementTop: number,
  viewportHeight: number,
  marginRatio: number = REVEAL_MARGIN_RATIO,
): boolean {
  // A zero or nonsensical viewport means we cannot tell where anything is
  // (jsdom, a hidden tab, a zero-height iframe). Showing the content is the
  // safe answer; animating it is not.
  if (!Number.isFinite(elementTop) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return false;
  }
  return elementTop > revealLimit(viewportHeight, marginRatio);
}

/**
 * Is a hidden element now due to be shown?
 *
 * The exact inverse of `shouldStartHidden`, which matters at the edges: an
 * element that has been scrolled clean past (top far negative) is due, and so
 * is one we cannot measure. Both used to be able to stay hidden forever --
 * see the note about jumps in use-reveal.ts.
 */
export function isDueToShow(
  elementTop: number,
  viewportHeight: number,
  marginRatio: number = REVEAL_MARGIN_RATIO,
): boolean {
  return !shouldStartHidden(elementTop, viewportHeight, marginRatio);
}
