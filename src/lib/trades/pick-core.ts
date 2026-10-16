import { EDITABLE_CORE_FIELDS, type EditableCoreField } from "./types";

/**
 * The editable core fields out of a request body, and nothing else: an
 * unknown key (id, user_id, a derived column) is dropped before validation.
 * Shared by creating a trade with its details and by saving an edit.
 */
export function pickEditableCore(input: unknown): Partial<Record<EditableCoreField, unknown>> {
  if (typeof input !== "object" || input === null) return {};
  const result: Partial<Record<EditableCoreField, unknown>> = {};
  for (const key of EDITABLE_CORE_FIELDS) {
    if (key in input) {
      result[key] = (input as Record<string, unknown>)[key];
    }
  }
  return result;
}
