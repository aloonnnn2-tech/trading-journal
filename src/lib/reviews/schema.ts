import { z } from "zod";
import { MAX_COMMENT, MAX_DISPLAY_NAME, REVIEW_SOURCES } from "./types";

// The validation half of ./types, kept apart so the review form and prompt
// (mounted in the root layout) don't pull zod into every page. Only the
// reviews route imports this.

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
