// Collapse the semantic parser's candidate list into one field per key,
// keeping the highest-confidence reading. OCR frequently reports the same
// label/value twice (e.g. a value echoed in a header and a table); this drops
// the duplicates rather than letting a lower-confidence copy win.

import type { DetectedField, DetectedFields } from "./types";

export function dedupe(candidates: DetectedField[]): DetectedFields {
  const best: DetectedFields = {};
  for (const c of candidates) {
    const existing = best[c.key];
    if (!existing || c.confidence > existing.confidence) {
      best[c.key] = c;
    }
  }
  return best;
}
