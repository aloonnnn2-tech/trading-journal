import { describe, expect, it } from "vitest";
import { frontCard, turnsToReach } from "./orbit";

describe("frontCard", () => {
  it("cycles through the cards as hand-offs accumulate", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((w) => frontCard(w, 3))).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });
});

describe("turnsToReach", () => {
  it("does not move when the chosen card is already at the front", () => {
    expect(turnsToReach(0, 0, 3)).toBe(0);
    expect(turnsToReach(7, 1, 3)).toBe(7); // 7 mod 3 = 1
  });

  it("turns forward to a card further round", () => {
    expect(turnsToReach(0, 1, 3)).toBe(1);
    expect(turnsToReach(0, 2, 3)).toBe(2);
  });

  it("turns forward, never back, to a card that just went past", () => {
    // From card 2 at the front, card 1 is one step behind: reaching it goes
    // forward two hand-offs, round the back, rather than reversing one.
    expect(turnsToReach(2, 1, 3)).toBe(4);
    expect(turnsToReach(2, 0, 3)).toBe(3);
  });

  it("never turns more than one lap", () => {
    for (let whole = 0; whole < 12; whole++) {
      for (let target = 0; target < 3; target++) {
        const next = turnsToReach(whole, target, 3);
        expect(next - whole).toBeGreaterThanOrEqual(0);
        expect(next - whole).toBeLessThan(3);
        expect(frontCard(next, 3)).toBe(target);
      }
    }
  });

  it("rejects input that would put the stack between cards", () => {
    expect(() => turnsToReach(1.5, 0, 3)).toThrow(RangeError);
    expect(() => turnsToReach(0, 0.5, 3)).toThrow(RangeError);
    expect(() => turnsToReach(0, 0, 0)).toThrow(RangeError);
  });
});
