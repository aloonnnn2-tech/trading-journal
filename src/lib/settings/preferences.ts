import { z } from "zod";

// Setup -> Settings switches (migration 0054, user_settings.preferences).
//
// One jsonb object, validated here on every read and write. Adding a switch
// is: add a field to the schema and a default below -- no migration, no
// grant, no missing-column fallback. Anything stored that this schema doesn't
// accept (a stale shape, a hand edit) reads as the default for that field
// rather than failing the page.
//
// Deliberately free of server imports: the client provider and the Settings
// form use the same types and defaults.

export const preferencesSchema = z.object({
  /** Clicking a trade in the list opens the side preview (true) or the full trade page. */
  tradePreview: z.boolean(),
  /** The n / g+letter / slash / ? keys, and ←/→ in the trade preview. */
  keyboardShortcuts: z.boolean(),
  /** Light or dark, saved to the account so every browser matches. Null = this browser decides. */
  theme: z.enum(["light", "dark"]).nullable(),
  /** The "take the paid-features tour" card and similar nudges. */
  tourOffers: z.boolean(),
  /** Cards lift slightly under the pointer. */
  hoverMotion: z.boolean(),
});

export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencesPatch = Partial<Preferences>;

export const DEFAULT_PREFERENCES: Preferences = {
  tradePreview: true,
  keyboardShortcuts: true,
  theme: null,
  tourOffers: true,
  hoverMotion: true,
};

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
      (out as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return out;
}
