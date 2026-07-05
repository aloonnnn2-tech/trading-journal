import { z } from "zod";
import type { FieldDefinition } from "./types";

// Runtime validator for a single field's value, derived from its
// field_type. Shared by the trade-update API route now, and by the
// template editor / CSV import column-mapping later -- one source of
// truth for "what does a valid value for this field type look like."
export function fieldValueSchema(field: FieldDefinition): z.ZodTypeAny {
  switch (field.field_type) {
    case "text":
    case "large_notes":
    case "date":
    case "color_picker":
    case "dropdown":
      return z.string();
    case "number":
    case "currency":
    case "percentage":
      return z.number();
    case "rating": {
      const min = field.options.min ?? 1;
      const max = field.options.max ?? 10;
      return z.number().min(min).max(max);
    }
    case "checkbox":
      return z.boolean();
    case "multi_select":
    case "tag":
      return z.array(z.string());
    default:
      return z.unknown();
  }
}

// Builds a schema validating a partial custom_fields update -- only keys
// present in the user's current field definitions are accepted, and any
// of them may be null (cleared) or omitted.
export function buildCustomFieldsSchema(fields: FieldDefinition[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.key] = fieldValueSchema(field).nullable().optional();
  }
  return z.object(shape).partial();
}
