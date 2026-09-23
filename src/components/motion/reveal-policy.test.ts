import { describe, expect, it } from "vitest";
import { REVEAL_MARGIN_RATIO, isDueToShow, revealLimit, shouldStartHidden } from "./reveal-policy";

const VH = 800;
/** The bottom of the reveal band for an 800px viewport: 800 + 20% = 960. */
const BAND = VH * (1 + REVEAL_MARGIN_RATIO);

describe("shouldStartHidden", () => {
  it("hides an element well below the fold, so it can animate in", () => {
    expect(shouldStartHidden(2000, VH)).toBe(true);
    expect(shouldStartHidden(BAND + 1, VH)).toBe(true);
  });

  it("leaves an element on screen alone", () => {
    expect(shouldStartHidden(0, VH)).toBe(false);
    expect(shouldStartHidden(400, VH)).toBe(false);
    expect(shouldStartHidden(VH - 1, VH)).toBe(false);
  });

  it("leaves an element only partly on screen alone", () => {
    // Top edge just above the fold: the reader can see part of it, so hiding
    // it would blank something already on screen.
    expect(shouldStartHidden(-50, VH)).toBe(false);
  });

  it("leaves an element scrolled past above the viewport alone", () => {
    // Matters on a reload with restored scroll position: everything above is
    // far negative and must not be wiped out.
    expect(shouldStartHidden(-5000, VH)).toBe(false);
  });

  it("leaves an element inside the band alone", () => {
    // Inside the band it is about to be scrolled to, so showing it outright
    // means it can never be caught mid-fade.
    expect(shouldStartHidden(VH + 1, VH)).toBe(false);
    expect(shouldStartHidden(BAND, VH)).toBe(false);
  });

  it("shows content when the viewport cannot be measured", () => {
    // jsdom, a background tab, a zero-height frame. Never animate on a guess.
    expect(shouldStartHidden(2000, 0)).toBe(false);
    expect(shouldStartHidden(2000, -1)).toBe(false);
    expect(shouldStartHidden(Number.NaN, VH)).toBe(false);
    expect(shouldStartHidden(2000, Number.NaN)).toBe(false);
  });

  it("honours a custom margin ratio", () => {
    // A ratio of 0 makes the band the viewport itself.
    expect(shouldStartHidden(VH + 1, VH, 0)).toBe(true);
    expect(shouldStartHidden(VH - 1, VH, 0)).toBe(false);
    // A large ratio keeps more of the page static.
    expect(shouldStartHidden(1500, VH, 1)).toBe(false);
  });

  it("puts the line 20% of a viewport below the fold", () => {
    expect(revealLimit(VH)).toBe(960);
    expect(revealLimit(VH, 0)).toBe(VH);
  });
});

describe("isDueToShow", () => {
  // The inverse matters at the edges. A jump -- End, a #hash link, scroll
  // restoration -- can leave a hidden element far above the viewport having
  // never intersected it. If that is not "due", it stays invisible forever,
  // which is exactly what an IntersectionObserver did here.
  it("is due once the element is scrolled past, not only while on screen", () => {
    expect(isDueToShow(-5000, VH)).toBe(true);
    expect(isDueToShow(-1, VH)).toBe(true);
    expect(isDueToShow(0, VH)).toBe(true);
  });

  it("is due at the line and on screen", () => {
    expect(isDueToShow(BAND, VH)).toBe(true);
    expect(isDueToShow(400, VH)).toBe(true);
  });

  it("is not due below the line", () => {
    expect(isDueToShow(BAND + 1, VH)).toBe(false);
    expect(isDueToShow(9999, VH)).toBe(false);
  });

  it("is due when the viewport cannot be measured, rather than stuck hidden", () => {
    expect(isDueToShow(2000, 0)).toBe(true);
    expect(isDueToShow(Number.NaN, VH)).toBe(true);
  });

  it("is the exact inverse of shouldStartHidden", () => {
    for (const top of [-5000, -1, 0, 400, VH, BAND, BAND + 1, 9999, Number.NaN]) {
      expect(isDueToShow(top, VH)).toBe(!shouldStartHidden(top, VH));
    }
  });
});
