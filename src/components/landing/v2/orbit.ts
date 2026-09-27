// The card stack's arithmetic, kept out of the component so it can be tested.
//
// The stack is driven by one number, `turns`: how many hand-offs have happened.
// Card i sits at angle (i - turns) thirds of a circle, so the card at the
// front is `turns mod count`. Every hand-off, whether the clock makes it or a
// click does, moves `turns` forward.

/** Positive modulo: `-1 mod 3` is 2 here, not -1 as JS's `%` gives. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Which card is at the front after `whole` complete hand-offs. */
export function frontCard(whole: number, count: number): number {
  return mod(whole, count);
}

/**
 * The hand-off count that brings `target` to the front, turning forward from
 * `whole`: never backwards, and never more than one lap.
 *
 * Forward only, because the orbit has a direction -- card 1 comes forward
 * after card 0 -- and a click that spun it the other way would read as a
 * different machine. Choosing the card already at the front returns `whole`
 * unchanged: no movement.
 */
export function turnsToReach(whole: number, target: number, count: number): number {
  if (!Number.isInteger(whole) || !Number.isInteger(target) || count < 1) {
    throw new RangeError(`bad orbit input: whole=${whole} target=${target} count=${count}`);
  }
  return whole + mod(target - frontCard(whole, count), count);
}
