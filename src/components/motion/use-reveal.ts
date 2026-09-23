"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { isDueToShow, revealLimit, shouldStartHidden } from "@/components/motion/reveal-policy";

export type RevealDirection = "up" | "left" | "right";

// One scroll listener for the whole page, shared by every reveal on it, and
// removed again the moment nothing is left to show.
//
// **Why not IntersectionObserver.** It was the obvious choice and it was
// wrong. An observer fires when an element's intersection CHANGES, and a jump
// -- End, a #hash link, browser scroll restoration, scrollTo -- moves an
// element from below the viewport to above it between two frames, so it never
// intersects and no callback ever comes. Measured on this page: jumping to
// the bottom left 34 of 41 reveals stuck at opacity 0, and scrolling back up
// showed a page full of holes. Asking "is it at or above the line yet" on
// each frame of scroll has no such gap.
const pendingReveals = new Set<HTMLElement>();
let frame = 0;

function show(el: HTMLElement) {
  delete el.dataset.revealPending;
  el.dataset.revealState = "shown";
  pendingReveals.delete(el);
}

function flush() {
  frame = 0;
  const limit = revealLimit(window.innerHeight);
  for (const el of [...pendingReveals]) {
    // `<= limit` rather than "intersects": an element scrolled clean past is
    // above the line too, and must end up shown like everything else.
    if (el.getBoundingClientRect().top <= limit) show(el);
  }
  if (pendingReveals.size === 0) stopListening();
}

function onScroll() {
  // Throttled to one measurement pass per frame, so a fast scroll costs one
  // rect read per still-pending element rather than one per scroll event.
  if (!frame) frame = requestAnimationFrame(flush);
}

let listening = false;

function startListening() {
  if (listening) return;
  listening = true;
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
}

function stopListening() {
  if (!listening) return;
  listening = false;
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onScroll);
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}

/**
 * The scroll entrance, as a hook, so it can be attached to an element that is
 * already something else -- a `motion.div` carrying a hover spring, say --
 * instead of being wrapped in a box that changes the layout.
 *
 * How it works, and why in this order:
 *
 *   1. Server render: the element carries `data-reveal` and nothing else. No
 *      opacity, no transform. `curl` gets the finished page, and so does a
 *      visitor whose JS never arrives.
 *   2. useLayoutEffect, before the browser paints: measure. If the element is
 *      comfortably below the fold (see reveal-policy.ts) mark it hidden --
 *      nobody can see that happen, because it is off screen. Anything already
 *      on or near the screen stays visible and never animates at all.
 *   3. A shared, rAF-throttled scroll listener shows each hidden element once
 *      it reaches the line, which sits 20% of a viewport BELOW the bottom
 *      edge -- so it finishes before you are looking at it.
 *
 * The transition itself lives in globals.css, so `prefers-reduced-motion:
 * reduce` switches it off in one place and takes the hidden state with it.
 */
export function useReveal<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Asked in JS as well as in CSS: with the preference set there is nothing
    // to show later, so don't hide anything and don't start a listener.
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    if (!shouldStartHidden(el.getBoundingClientRect().top, window.innerHeight)) return;

    el.dataset.revealState = "hidden";
    el.dataset.revealPending = "";
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || el.dataset.revealPending === undefined) return;

    // Re-check before registering: layout can have moved between the layout
    // effect and here (a font landing, an image sizing), and an element that
    // is now due should not wait for a scroll that may never come.
    if (isDueToShow(el.getBoundingClientRect().top, window.innerHeight)) {
      show(el);
      return;
    }

    pendingReveals.add(el);
    startListening();

    return () => {
      pendingReveals.delete(el);
      if (pendingReveals.size === 0) stopListening();
    };
  }, []);

  return ref;
}
