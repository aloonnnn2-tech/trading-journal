import { describe, expect, it } from "vitest";
import { DETECTED_LABELS } from "./analyze";
import { suggestionsFor } from "./suggestions";

// A suggestion has exactly two ways to disappear: accepted, or turned down.
// Getting either wrong makes the panel useless -- one re-offers what you just
// added, the other nags forever about what you already rejected.

const MOVED = DETECTED_LABELS.movedStop;
const EARLY = DETECTED_LABELS.exitedEarly;

describe("suggestionsFor", () => {
  it("offers a detected label that has not been dealt with", () => {
    const result = suggestionsFor([MOVED], [], []);
    expect(result.map((s) => s.label)).toEqual([MOVED]);
    expect(result[0].reason).toContain("stop changed");
  });

  it("stops offering a label once it has been tagged", () => {
    // Otherwise accepting a suggestion leaves it suggested forever.
    expect(suggestionsFor([MOVED], [MOVED], [])).toEqual([]);
  });

  it("stops offering a label once it has been dismissed", () => {
    expect(suggestionsFor([MOVED], [], [MOVED])).toEqual([]);
  });

  it("keeps offering the others when one is dealt with", () => {
    const result = suggestionsFor([MOVED, EARLY], [MOVED], []);
    expect(result.map((s) => s.label)).toEqual([EARLY]);
  });

  it("offers a label once even if detected twice", () => {
    expect(suggestionsFor([MOVED, MOVED], [], [])).toHaveLength(1);
  });

  it("offers nothing when nothing was detected", () => {
    expect(suggestionsFor([], [MOVED], [EARLY])).toEqual([]);
  });

  it("explains every label it can offer", () => {
    // A suggestion the trader cannot judge is one they will accept blindly or
    // ignore entirely.
    const all = Object.values(DETECTED_LABELS);
    for (const s of suggestionsFor(all, [], [])) {
      expect(s.reason).not.toBe(s.label);
      expect(s.reason.length).toBeGreaterThan(10);
    }
  });

  it("falls back to the label rather than an empty reason", () => {
    const result = suggestionsFor(["Something new"], [], []);
    expect(result[0].reason).toBe("Something new");
  });
});

// The two vocabularies. 0034 seeds the Mistakes field with "Exited too early"
// and "Oversized"; the detectors say "Exited before target" and "Oversized
// position". A trade tagged in the trader's own wording must not be offered
// the detector's wording for the same habit -- that was observed on a real
// trade, which ended up carrying both.
describe("suggestionsFor — the trader's own wording", () => {
  it("does not offer 'Exited before target' when 'Exited too early' is tagged", () => {
    expect(suggestionsFor([DETECTED_LABELS.exitedEarly], ["Exited too early"], [])).toEqual([]);
  });

  it("does not offer 'Oversized position' when 'Oversized' is tagged", () => {
    expect(suggestionsFor([DETECTED_LABELS.oversized], ["Oversized"], [])).toEqual([]);
  });

  it("matches a synonym whatever its case", () => {
    // The tag field is a free-text comma-separated box, so the seeded choices
    // are a suggestion to the user, not a constraint.
    expect(suggestionsFor([DETECTED_LABELS.oversized], ["OVERSIZED"], [])).toEqual([]);
    expect(suggestionsFor([DETECTED_LABELS.movedStop], ["moved stop"], [])).toEqual([]);
  });

  it("still offers a label whose synonym is absent", () => {
    const result = suggestionsFor([DETECTED_LABELS.exitedEarly], ["Revenge trade"], []);
    expect(result.map((s) => s.label)).toEqual([DETECTED_LABELS.exitedEarly]);
  });

  it("does not treat an unrelated label as a synonym", () => {
    // "Moved target" has no seeded equivalent; tagging "Moved stop" must not
    // silence it, or a real observation disappears.
    const result = suggestionsFor([DETECTED_LABELS.movedTarget], ["Moved stop"], []);
    expect(result.map((s) => s.label)).toEqual([DETECTED_LABELS.movedTarget]);
  });
});
