// Setup -> Settings switches (migration 0054, user_settings.preferences).
//
// One jsonb object, validated on every read and write by the schema in
// ./preferences-schema. Adding a switch is: add a field to the type and a
// default below, and the same field to the schema -- no migration, no
// grant, no missing-column fallback. Anything stored that the schema doesn't
// accept (a stale shape, a hand edit) reads as the default for that field
// rather than failing the page.
//
// Deliberately free of server imports AND of zod: PreferencesProvider is in
// the root layout, so whatever this module imports ships on every page.
// With the schema in here, zod (about 51 KB compressed) rode along to the
// homepage and sign-in page for two constants (full check, 2026-10-12).

export interface Preferences {
  /** Clicking a trade in the list opens the side preview (true) or the full trade page. */
  tradePreview: boolean;
  /** The n / g+letter / slash / ? keys, and ←/→ in the trade preview. */
  keyboardShortcuts: boolean;
  /** Light or dark, saved to the account so every browser matches. Null = this browser decides. */
  theme: "light" | "dark" | null;
  /** The "take the paid-features tour" card and similar nudges. */
  tourOffers: boolean;
  /** Cards lift slightly under the pointer. */
  hoverMotion: boolean;
}

export type PreferencesPatch = Partial<Preferences>;

export const DEFAULT_PREFERENCES: Preferences = {
  tradePreview: true,
  keyboardShortcuts: true,
  theme: null,
  tourOffers: true,
  hoverMotion: true,
};
