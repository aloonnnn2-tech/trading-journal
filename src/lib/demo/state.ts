// The optional demo journal's lifecycle (Phase 4D of docs/design-audit.md;
// migration 0051 holds the state). Pure, so the one rule that decides who is
// asked can be tested.
//
//   null        not asked yet
//   declined    said no -- never offered again
//   active      the demo journal is in the account
//   done        switched to their own journal -- never offered again
//   unavailable 0051 isn't applied yet: the app behaves as if the demo
//               doesn't exist

export type DemoState = null | "declined" | "active" | "done" | "unavailable";

export function parseDemoState(value: unknown): Exclude<DemoState, "unavailable"> {
  return value === "declined" || value === "active" || value === "done" ? value : null;
}

/**
 * Whether to ask "Start with a demo journal?". Only on a genuine first login:
 * never answered, nothing in the journal, and the first tour not yet seen.
 * The migration backfills `declined` for existing accounts, and the tour and
 * trade checks here keep anyone who slipped through from being asked over a
 * journal they already started.
 */
export function shouldOfferDemo(input: {
  demoState: DemoState;
  hasTrades: boolean;
  hasCompletedTour: boolean;
}): boolean {
  return input.demoState === null && !input.hasTrades && !input.hasCompletedTour;
}
