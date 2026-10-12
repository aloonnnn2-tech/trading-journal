import { z } from "zod";
import { DEFAULT_PREFERENCES, type Preferences } from "./preferences";

// The validation half of ./preferences, kept apart so the client provider in
// the root layout doesn't pull zod into every page. Server code (the
// preferences route and preferences-queries) and the Settings form's tests
// import from here.

export const preferencesSchema = z.object({
  tradePreview: z.boolean(),
  keyboardShortcuts: z.boolean(),
  theme: z.enum(["light", "dark"]).nullable(),
  tourOffers: z.boolean(),
  hoverMotion: z.boolean(),
});

// Compile-time guard: the schema and the Preferences type must describe the
// same object. A field added to one and not the other fails `tsc` here.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const _schemaMatchesType: Same<z.infer<typeof preferencesSchema>, Preferences> = true;
void _schemaMatchesType;

/** A patch as the API accepts it: any subset, nothing unknown. */
export const preferencesPatchSchema = preferencesSchema.partial().strict();

/**
 * Stored value -> full preferences. Field by field, so one bad field falls
 * back to its default without discarding the others.
 */
export function parsePreferences(stored: unknown): Preferences {
  const out: Preferences = { ...DEFAULT_PREFERENCES };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  const shape = preferencesSchema.shape;
  for (const key of Object.keys(shape) as (keyof Preferences)[]) {
    const parsed = shape[key].safeParse((stored as Record<string, unknown>)[key]);
    if (parsed.success && (stored as Record<string, unknown>)[key] !== undefined) {
      (out as unknown as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return out;
}
