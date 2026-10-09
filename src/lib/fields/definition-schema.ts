import { z } from "zod";
import { ENTITY_TYPES, FIELD_TYPES } from "./types";

/**
 * Request schemas for /api/field-definitions (security hardening, Phase 4).
 *
 * `options` is the FieldOptions object the field manager actually sends --
 * `{ choices: [...] }` for dropdown/tag/multi-select, `{}` otherwise, and
 * `{ min, max }` on a rating. The hand-written check this replaced demanded a
 * bare string array, so every edit from the Fields page was refused with
 * "Invalid options".
 */

const LABEL = z.string().trim().min(1, "Give the field a name.").max(80, "Keep the name under 80 characters.");

export const fieldOptionsSchema = z
  .object({
    choices: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .strict();

const SORT_ORDER = z.number().int().min(0).max(100_000);

export const fieldDefinitionCreateSchema = z
  .object({
    label: LABEL,
    field_type: z.enum(FIELD_TYPES),
    entity_type: z.enum(ENTITY_TYPES).default("trade"),
    options: fieldOptionsSchema.default({}),
    sort_order: SORT_ORDER.default(200),
    strategy_id: z.uuid().nullable().default(null),
  })
  .strict();

export const fieldDefinitionPatchSchema = z
  .object({
    label: LABEL.optional(),
    field_type: z.enum(FIELD_TYPES).optional(),
    options: fieldOptionsSchema.optional(),
    sort_order: SORT_ORDER.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

/** The stable key a new field is stored under, derived from its label. */
export function fieldKeyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
