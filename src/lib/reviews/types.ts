import { z } from "zod";

// A review of Trading Lens itself (migration 0064). One per account.

/** Where the review was asked for; kept so Alon can see which moments work. */
export const REVIEW_SOURCES = ["closed_trades", "wow_import", "wow_ai_review", "two_weeks", "homepage", "account_menu"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const SOURCE_LABELS: Record<ReviewSource, string> = {
  closed_trades: "After 5 closed trades",
  wow_import: "After a screenshot import",
  wow_ai_review: "After an AI review",
  two_weeks: "After 2 weeks of use",
  homepage: "Homepage button",
  account_menu: "Account menu",
};

export const MAX_COMMENT = 1000;
export const MAX_DISPLAY_NAME = 40;

/** What the writer sends. Blank text becomes null, never an empty string. */
export const reviewInputSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z
      .string()
      .max(MAX_COMMENT)
      .transform((s) => s.trim() || null)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    allowPublic: z.boolean(),
    displayName: z
      .string()
      .max(MAX_DISPLAY_NAME)
      .transform((s) => s.trim() || null)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    source: z.enum(REVIEW_SOURCES),
  })
  .strict();
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export interface MyReview {
  rating: number;
  comment: string | null;
  allowPublic: boolean;
  displayName: string | null;
  featured: boolean;
  updatedAt: string;
}

export interface FeaturedReview {
  rating: number;
  comment: string;
  displayName: string | null;
  reviewedAt: string;
}

/** The name a homepage card shows. */
export function shownName(displayName: string | null): string {
  return displayName?.trim() || "Trading Lens user";
}

/** Only a public, 4-5 star review with a quote can go on the homepage
 *  (the same rule as the database's check constraint). */
export function canFeature(r: { rating: number; comment: string | null; allowPublic: boolean }): boolean {
  return r.allowPublic && r.rating >= 4 && Boolean(r.comment?.trim());
}
