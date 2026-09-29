"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { DEFAULT_PREFERENCES, type Preferences, type PreferencesPatch } from "@/lib/settings/preferences";

// Setup -> Settings, as every client component sees it. The root layout reads
// the stored object once per request and hands it in here, so a switch
// applies on the first paint of every page -- no fetch, no flash of the
// default -- and flipping it on the Settings page applies app-wide at once.

interface PreferencesContextValue {
  prefs: Preferences;
  /**
   * False while signed out or while migration 0054 isn't applied: the
   * defaults apply and there is nowhere to save a change.
   */
  saveable: boolean;
  /** Applies at once, saves in the background, reverts if the save fails. */
  update: (patch: PreferencesPatch) => Promise<boolean>;
}

const PreferencesContext = createContext<PreferencesContextValue>({
  prefs: DEFAULT_PREFERENCES,
  saveable: false,
  update: async () => false,
});

export function usePreferences(): PreferencesContextValue {
  return useContext(PreferencesContext);
}

export function PreferencesProvider({ initial, children }: { initial: Preferences | null; children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(initial ?? DEFAULT_PREFERENCES);
  const saveable = initial !== null;
  // The latest value for update()'s revert, without making update() change
  // identity on every flip.
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const update = useCallback(
    async (patch: PreferencesPatch) => {
      const before = prefsRef.current;
      setPrefs({ ...before, ...patch });
      if (!saveable) return false;
      try {
        const res = await fetch("/api/settings/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences: patch }),
        });
        if (!res.ok) throw new Error(String(res.status));
        return true;
      } catch {
        setPrefs(before);
        return false;
      }
    },
    [saveable],
  );

  const value = useMemo(() => ({ prefs, saveable, update }), [prefs, saveable, update]);

  return (
    <PreferencesContext.Provider value={value}>
      <AccountThemeSync theme={prefs.theme} />
      {children}
    </PreferencesContext.Provider>
  );
}

/**
 * Brings this browser in line with the theme saved to the account. The theme
 * itself still lives in next-themes (localStorage, applied pre-paint), which
 * is why a second browser used to keep whatever it had last -- this is what
 * makes the account's choice follow the user. Runs on mount and whenever the
 * saved theme changes.
 */
function AccountThemeSync({ theme }: { theme: Preferences["theme"] }) {
  const { resolvedTheme, setTheme } = useTheme();
  useEffect(() => {
    if (theme && resolvedTheme && theme !== resolvedTheme) setTheme(theme);
  }, [theme, resolvedTheme, setTheme]);
  return null;
}

/**
 * The light/dark toggle, account-aware: flips this browser immediately and,
 * when signed in, saves the choice so other browsers follow.
 */
export function useAccountThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { saveable, update } = usePreferences();
  return useCallback(
    (next?: "light" | "dark") => {
      const theme = next ?? (resolvedTheme === "dark" ? "light" : "dark");
      setTheme(theme);
      if (saveable) void update({ theme });
    },
    [resolvedTheme, setTheme, saveable, update],
  );
}
