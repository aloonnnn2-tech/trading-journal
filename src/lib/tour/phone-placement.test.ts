import { describe, expect, it } from "vitest";
import { phoneDock, phoneScrollDelta } from "./phone-placement";

// A 360x640 phone: 60px tab bar, a card about 230px tall.
const base = { viewportH: 640, tabBarH: 60, cardH: 230, dialogOpen: false };

describe("phoneDock", () => {
  it("shrinks to a strip whenever a dialog or sheet is open", () => {
    expect(phoneDock({ ...base, dialogOpen: true, target: { top: 128, height: 54 } })).toBe("strip");
  });

  it("goes to the bottom for a target near the top", () => {
    expect(phoneDock({ ...base, target: { top: 83, height: 52 } })).toBe("bottom");
  });

  it("goes to the top for a target near the bottom -- the tab bar's More button", () => {
    expect(phoneDock({ ...base, target: { top: 572, height: 68 } })).toBe("top");
  });

  it("goes to the top for a panel low on the page", () => {
    expect(phoneDock({ ...base, target: { top: 400, height: 120 } })).toBe("top");
  });

  it("covers as little as it can of a target taller than the room left", () => {
    // Most of it is in the lower part of the screen: covering the top costs less.
    expect(phoneDock({ ...base, target: { top: 150, height: 450 } })).toBe("top");
    // Most of it is in the upper part: covering the bottom costs less.
    expect(phoneDock({ ...base, target: { top: 60, height: 420 } })).toBe("bottom");
  });

  it("goes to the bottom when there is nothing to point at", () => {
    expect(phoneDock({ ...base, target: null })).toBe("bottom");
  });
});

describe("phoneScrollDelta", () => {
  const layout = { viewportH: 640, tabBarH: 60, cardH: 230, headerH: 52 };

  it("leaves a target that is already clear of the card alone", () => {
    expect(phoneScrollDelta({ top: 100, height: 120 }, layout)).toBe(0);
  });

  it("brings a target hidden under the card up to just below the top bar", () => {
    expect(phoneScrollDelta({ top: 500, height: 126 }, layout)).toBe(500 - 70);
  });

  it("brings a tall target's top edge into view rather than its middle", () => {
    expect(phoneScrollDelta({ top: 246, height: 400 }, layout)).toBe(246 - 70);
  });

  it("scrolls back down to a target above the top bar", () => {
    expect(phoneScrollDelta({ top: -300, height: 100 }, layout)).toBe(-370);
  });
});
