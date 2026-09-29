"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/Switch";
import { useAccountThemeToggle, usePreferences } from "@/components/preferences/preferences-provider";
import type { Preferences } from "@/lib/settings/preferences";

// The switches on Setup -> Settings. Each applies the moment it's flipped,
// saves in the background and says so; a failed save puts it back and says
// that instead.

type Status = "idle" | "saved" | "error";

export function SettingsForm({ initialShowTradeSummary }: { initialShowTradeSummary: boolean | null }) {
  const { prefs, saveable, update } = usePreferences();
  const setAccountTheme = useAccountThemeToggle();
  // Before a theme is saved to the account, show what this browser uses --
  // after hydration only: the server can't know it, and guessing would
  // mismatch the server HTML.
  const { resolvedTheme } = useTheme();
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const theme = prefs.theme ?? (hydrated ? resolvedTheme : undefined);
  const [status, setStatus] = useState<Record<string, Status>>({});

  const mark = (key: string, ok: boolean) => setStatus((s) => ({ ...s, [key]: ok ? "saved" : "error" }));

  async function flip<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    mark(key, await update({ [key]: value } as Partial<Preferences>));
  }

  const unavailable = !saveable ? "This setting will be available shortly. Until then the default applies." : null;

  return (
    <div className="flex flex-col gap-8">
      <Group title="Display">
        <Row
          title="Theme"
          hint="Saved to your account, so every browser and device you sign in on matches."
          status={status.theme}
          note={unavailable}
          control={
            <div role="radiogroup" aria-label="Theme" className="flex shrink-0 rounded-lg border border-zinc-200 p-0.5 dark:border-subtle">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={theme === t}
                  disabled={!saveable}
                  onClick={() => {
                    setAccountTheme(t);
                    mark("theme", true);
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm capitalize disabled:opacity-50 ${
                    theme === t
                      ? "bg-primary text-white dark:text-zinc-950"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          }
        />
        <SwitchRow
          title="Hover motion"
          hint="Cards lift slightly under the pointer."
          checked={prefs.hoverMotion}
          disabled={!saveable}
          onChange={(v) => flip("hoverMotion", v)}
          status={status.hoverMotion}
          note={unavailable}
        />
      </Group>

      <Group title="Trades">
        <SwitchRow
          title="Preview trades in a side panel"
          hint="Clicking a trade in the list opens a quick preview beside it. Off: it opens the full trade page."
          checked={prefs.tradePreview}
          disabled={!saveable}
          onChange={(v) => flip("tradePreview", v)}
          status={status.tradePreview}
          note={unavailable}
        />
        <TradeSummaryRow initial={initialShowTradeSummary} />
      </Group>

      <Group title="Help">
        <SwitchRow
          title="Keyboard shortcuts"
          hint="n for a new trade, g then a letter to jump between pages, / to search, ? for the list, ← → in the trade preview."
          checked={prefs.keyboardShortcuts}
          disabled={!saveable}
          onChange={(v) => flip("keyboardShortcuts", v)}
          status={status.keyboardShortcuts}
          note={unavailable}
        />
        <SwitchRow
          title="Tour offers"
          hint="The card suggesting a tour of the paid features. Tours stay available from the ? menu either way."
          checked={prefs.tourOffers}
          disabled={!saveable}
          onChange={(v) => flip("tourOffers", v)}
          status={status.tourOffers}
          note={unavailable}
        />
      </Group>
    </div>
  );
}

const noopSubscribe = () => () => {};

// The summary strip predates the preferences object and keeps its own column
// (0052) and its own save.
function TradeSummaryRow({ initial }: { initial: boolean | null }) {
  const available = initial !== null;
  const [on, setOn] = useState(initial ?? true);
  const [status, setStatus] = useState<Status>("idle");
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    setOn(next);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showTradeSummary: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("saved");
    } catch {
      setOn(!next);
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SwitchRow
      title="Summary strip on the Trades page"
      hint="Net P/L, win rate, profit factor, average hold, trade count and expectancy for the trades your filters show, above the trade list."
      checked={on}
      disabled={!available || saving}
      onChange={toggle}
      status={status}
      note={available ? null : "This setting will be available shortly. Until then the strip is always shown."}
    />
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">{title}</h2>
      <div className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(28,27,24,0.05)] dark:divide-subtle dark:border-subtle dark:bg-card">
        {children}
      </div>
    </section>
  );
}

function SwitchRow({
  title,
  hint,
  checked,
  disabled,
  onChange,
  status,
  note,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  status?: Status;
  note?: string | null;
}) {
  const labelId = useId();
  const hintId = useId();
  return (
    <Row
      title={title}
      hint={hint}
      status={status}
      note={note}
      labelId={labelId}
      hintId={hintId}
      control={<Switch checked={checked} onChange={onChange} disabled={disabled} labelledBy={labelId} describedBy={hintId} />}
    />
  );
}

function Row({
  title,
  hint,
  control,
  status,
  note,
  labelId,
  hintId,
}: {
  title: string;
  hint: string;
  control: ReactNode;
  status?: Status;
  note?: string | null;
  labelId?: string;
  hintId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 sm:gap-6 sm:p-5">
      <div className="min-w-0">
        <p id={labelId} className="font-medium text-zinc-900 dark:text-zinc-50">
          {title}
        </p>
        <p id={hintId} className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {hint}
        </p>
        <p aria-live="polite" className="mt-1 min-h-4 text-xs">
          {note ? (
            <span className="text-zinc-500">{note}</span>
          ) : status === "saved" ? (
            <span className="text-profit">Saved.</span>
          ) : status === "error" ? (
            <span className="text-loss">Couldn&apos;t save that. Try again.</span>
          ) : null}
        </p>
      </div>
      {control}
    </div>
  );
}
