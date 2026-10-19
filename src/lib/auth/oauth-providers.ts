import type { Provider } from "@supabase/supabase-js";

// Sign-in providers this app offers a button for. Adding one is an entry
// here (and its switch in the Supabase dashboard); the buttons, the callback
// and the "only when enabled" check all read this list.
export const OAUTH_PROVIDERS: readonly { id: Provider; label: string }[] = [{ id: "google", label: "Google" }];

/**
 * Which of our providers Supabase has switched on, from the public
 * /auth/v1/settings answer (`{ external: { google: true, ... } }`).
 *
 * The buttons follow the dashboard rather than a flag in this codebase, so a
 * provider never shows a button that fails ("provider is not enabled")
 * before its keys are in, and switching one off in Supabase hides it here.
 */
export function enabledProviders(settings: unknown): Provider[] {
  const external = (settings as { external?: Record<string, unknown> } | null)?.external;
  if (!external || typeof external !== "object") return [];
  return OAUTH_PROVIDERS.filter((p) => external[p.id] === true).map((p) => p.id);
}
