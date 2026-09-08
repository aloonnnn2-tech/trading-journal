import type { AIProviderName } from "@/lib/ai-keys/types";

/** Must stay in sync with 0032's `check (review_type in (...))`. */
export const REVIEW_TYPES = ["trade", "weekly", "monthly", "custom"] as const;

export type ReviewType = (typeof REVIEW_TYPES)[number];

/**
 * A stored review as read back from `ai_reviews` (0032).
 *
 * Generic in its content so each caller names the shape it actually expects --
 * `StoredReview<TradeReviewContent>` for a trade review -- rather than every
 * consumer re-narrowing an `unknown`. The row's `review_type` is what says
 * which content shape is inside; the two are set together and never apart.
 *
 * `period_start` / `period_end` are date strings (YYYY-MM-DD), not instants:
 * the column is `date`, because the period a review covers is a human-facing
 * local range. See the comment in 0032.
 */
export interface StoredReview<TContent = unknown> {
  id: string;
  review_type: ReviewType;
  trade_id: string | null;
  period_start: string | null;
  period_end: string | null;
  trades_analyzed: number;
  provider: AIProviderName;
  model: string;
  content: TContent;
  source_updated_at: string | null;
  created_at: string;
}

/**
 * A stored review plus whether the data underneath it has changed since.
 *
 * Computed at read time rather than stored, because it is a comparison
 * against live data -- a flag written at generation time would be correct
 * for exactly as long as nobody edited anything.
 */
export interface ReviewWithFreshness<TContent = unknown> {
  review: StoredReview<TContent>;
  stale: boolean;
}
