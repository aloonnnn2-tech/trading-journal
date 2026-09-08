import { DETECTED_LABELS } from "./analyze";

// Which detected labels are worth offering on a trade.
//
// **A suggestion is never written.** It is computed on read from the same
// detectors the mistake tracker uses, and only becomes journal data when the
// trader accepts it -- which writes it into the Mistakes field like any other
// tag. That is the brief's requirement that nothing silently modifies
// permanent journal data, and it is why accepting is an ordinary tag write
// rather than a special state.
//
// **No AI.** The brief says to prefer deterministic logic where a tag can be
// calculated from structured data, and every tag this app can offer is
// calculable: a moved stop and a moved target come from the edit-history
// snapshots, an early exit from the recorded target, an oversized position
// from the trader's own median risk. The tags a model might guess at instead
// -- FOMO, "A+ setup", late entry, high volume -- need either a judgement the
// trader alone can make or data this app does not hold (there is no planned
// entry price, and the market-data client discards volume). Guessing at those
// would be inventing journal entries.

/** Why a suggestion is being offered, shown so the trader can judge it. */
export const SUGGESTION_REASONS: Record<string, string> = {
  [DETECTED_LABELS.movedStop]: "the stop changed after this trade was logged",
  [DETECTED_LABELS.movedTarget]: "the target changed after this trade was logged",
  [DETECTED_LABELS.exitedEarly]: "it closed in profit but short of the recorded target",
  [DETECTED_LABELS.oversized]: "risk was more than 1.5x your median",
};

export interface Suggestion {
  label: string;
  reason: string;
}

/**
 * Labels that mean the same thing as a detected one.
 *
 * **Why this is needed.** The detectors and the Mistakes field grew separate
 * vocabularies: 0034 seeds the tag field with "Exited too early" and
 * "Oversized", while the detectors produce "Exited before target" and
 * "Oversized position". Nothing reconciled them, so on a trade already tagged
 * "Exited too early" the panel offered "Exited before target" -- a second name
 * for the thing the trader had already written down. Accepting it left the
 * trade carrying both, and the mistake tracker counting them as two separate
 * habits. That was observed on a real trade, not imagined.
 *
 * This suppresses the suggestion only. It never rewrites the trader's tag into
 * the detector's wording and never writes a synonym: the vocabulary in their
 * journal stays theirs. Matching is case-insensitive because the field is
 * free text -- 0034's choices are only a picker, and `field-input.tsx` renders
 * a tag field as a comma-separated text box, so "oversized" is as likely as
 * "Oversized".
 */
const SYNONYMS: Record<string, string[]> = {
  [DETECTED_LABELS.exitedEarly]: ["exited too early", "exited early"],
  [DETECTED_LABELS.oversized]: ["oversized"],
  // "Moved stop" matches the seeded choice exactly, and "Moved target" has no
  // seeded equivalent, so neither needs an alias.
};

/** Every spelling that counts as this label already being on the trade. */
function equivalents(label: string): string[] {
  return [label.toLowerCase(), ...(SYNONYMS[label] ?? [])];
}

/**
 * Detected labels the trader has neither accepted nor turned down.
 *
 * Both filters matter. An already-tagged label must not be re-offered, or
 * accepting one would leave it suggested forever; and a dismissed one must
 * stay gone, or the panel becomes noise on the trades that need it least.
 *
 * "Already tagged" includes the trader's own wording for the same thing --
 * see SYNONYMS.
 */
export function suggestionsFor(
  detected: string[],
  tagged: string[],
  dismissed: string[],
): Suggestion[] {
  // Lowercased so a synonym check and an exact check are the same comparison.
  const taken = new Set([...tagged, ...dismissed].map((l) => l.toLowerCase()));

  return Array.from(new Set(detected))
    .filter((label) => !equivalents(label).some((alias) => taken.has(alias)))
    .map((label) => ({
      label,
      // Falls back to the label rather than an empty string: a suggestion with
      // no explanation is still better than one that looks broken.
      reason: SUGGESTION_REASONS[label] ?? label,
    }));
}
