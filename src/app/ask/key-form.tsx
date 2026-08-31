"use client";

import { useState } from "react";
// Only the client-safe types module -- importing the provider registry here
// would pull server-side integration code into the browser bundle.
import {
  AI_PROVIDERS,
  FREE_TIER_PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_MODELS,
  type AIProviderName,
  type StoredApiKey,
} from "@/lib/ai-keys/types";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

// Where each provider's keys are actually issued. Users arriving here rarely
// have a key already, and "go find it yourself" is the point most of them
// would stall at.
const CONSOLE_URLS: Record<AIProviderName, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/app/apikey",
  groq: "https://console.groq.com/keys",
  openrouter: "https://openrouter.ai/keys",
  cerebras: "https://cloud.cerebras.ai/platform/apikeys",
};

// Free-tier providers first, so someone who doesn't want a billed account
// sees a workable option before a paid one.
const ORDERED_PROVIDERS = [...AI_PROVIDERS].sort((a, b) => {
  const freeA = FREE_TIER_PROVIDERS.has(a) ? 0 : 1;
  const freeB = FREE_TIER_PROVIDERS.has(b) ? 0 : 1;
  return freeA - freeB;
});

export function KeyForm({
  onAdded,
  compact = false,
}: {
  onAdded: (key: StoredApiKey) => void;
  compact?: boolean;
}) {
  const [provider, setProvider] = useState<AIProviderName>("groq");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFree = FREE_TIER_PROVIDERS.has(provider);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || saving) return;

    setSaving(true);
    setError(null);

    const res = await fetch("/api/ai-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, key: key.trim(), label: label.trim() || null }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't save that key.");
      return;
    }

    const created = (await res.json()) as StoredApiKey;
    // Clear immediately on success -- there is no reason for the plaintext key
    // to stay in a form field (or in React state) once it's stored.
    setKey("");
    setLabel("");
    onAdded(created);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {!compact && (
        <p className="text-sm text-zinc-500">
          Your key is encrypted before it&apos;s stored and is only ever used to answer your own
          questions. We check it works with {PROVIDER_LABELS[provider]} before saving it.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="provider" className="text-xs text-zinc-500">
          Provider
        </label>
        <select
          id="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value as AIProviderName)}
          className={inputClass}
        >
          {ORDERED_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
              {FREE_TIER_PROVIDERS.has(p) ? " — free tier" : ""}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a
            href={CONSOLE_URLS[provider]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Get a {PROVIDER_LABELS[provider]} key →
          </a>
          {/* Naming the model up front matters here: it decides both answer
              quality and, on the paid providers, what the user is billed. */}
          <span className="font-mono text-xs text-zinc-500">{PROVIDER_MODELS[provider]}</span>
        </div>

        {isFree ? (
          <p className="text-xs text-profit">
            Has a free tier — you can use this without adding a payment method.
          </p>
        ) : (
          <p className="text-xs text-zinc-500">
            Pay-as-you-go: questions are billed to your own {PROVIDER_LABELS[provider]} account.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="apikey" className="text-xs text-zinc-500">
          API key
        </label>
        <input
          id="apikey"
          // type=password so the key isn't shoulder-surfable and browsers
          // don't offer to autofill it from unrelated saved credentials.
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className={`${inputClass} font-mono`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="label" className="text-xs text-zinc-500">
          Label (optional)
        </label>
        <input
          id="label"
          type="text"
          placeholder="e.g. personal"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className={inputClass}
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={saving || !key.trim()}
        className="w-fit rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
      >
        {saving ? "Checking key..." : "Save key"}
      </button>
    </form>
  );
}
