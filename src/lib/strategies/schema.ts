import { z } from "zod";

// Shared by the strategy and folder routes, which previously took
// `String(body.name ?? "").trim()` with only a non-empty check -- no upper
// bound at all, against bare `text` columns. `color` and `description` went
// in entirely unvalidated.
//
// `color` is rendered as `style={{ backgroundColor }}`, which React applies
// through the CSSOM rather than raw CSS text, so an odd value there was never
// an injection risk -- the regex is about keeping the column meaningful, not
// about escaping.
const NAME = z.string().trim().min(1, "name is required").max(100, "name is too long");
const COLOR = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be a hex value like #0a9bff")
  .nullish();
const DESCRIPTION = z.string().max(500, "description is too long").nullish();

export const folderCreateSchema = z.object({
  name: NAME,
});

export const strategyCreateSchema = z.object({
  name: NAME,
  description: DESCRIPTION,
  color: COLOR,
});

// PATCH is partial: the strategy manager sends only the fields it changed
// (reordering sends sort_order alone, for instance).
export const strategyPatchSchema = z.object({
  name: NAME.optional(),
  description: DESCRIPTION,
  color: COLOR,
  sort_order: z.number().int().min(0).max(100_000).optional(),
});
