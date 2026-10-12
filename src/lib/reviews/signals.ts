import type { ReviewSource } from "./types";

// A "wow" moment just happened (a screenshot became a trade, an AI review
// came back): the review card may ask, once things are calm. A window
// event, like the tour's signals, so the feature never imports the card.
export const REVIEW_WOW_EVENT = "trading-lens:review-wow";

export function signalReviewWow(source: Extract<ReviewSource, "wow_import" | "wow_ai_review">): void {
  try {
    window.dispatchEvent(new CustomEvent(REVIEW_WOW_EVENT, { detail: { source } }));
  } catch {
    // Never let asking for a review break the thing that just worked.
  }
}
