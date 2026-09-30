"use client";

import { useState } from "react";
import { useMounted } from "@/lib/use-mounted";
import { Trash2 } from "lucide-react";
import { PROVIDER_LABELS, PROVIDER_MODELS, type StoredApiKey } from "@/lib/ai-keys/types";
import { Card } from "@/components/ui/Card";
import { KeyForm } from "./key-form";

// The stored-key list: test, switch on/off, remove, add another. Lifted out
// of the old ask-manager unchanged so the chat shell stays about the
// conversation. `keys` is owned by the parent -- the composer's key picker
// and the "all keys off" notice read the same list.
/** "Last used 5 min ago" / "Not used yet". */
function lastUsed(iso: string | null | undefined): string {
  if (!iso) return "Not used yet";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "Last used just now";
  if (mins < 60) return `Last used ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `Last used ${hours} h ago`;
  return `Last used ${Math.round(hours / 24)} days ago`;
}

export function KeyManager({
  keys,
  onKeysChange,
  onAdded,
  onError,
}: {
  keys: StoredApiKey[];
  onKeysChange: (update: (prev: StoredApiKey[]) => StoredApiKey[]) => void;
  onAdded: (created: StoredApiKey) => void;
  onError: (message: string) => void;
}) {
  // Per-key result of an explicit "Test" -- keyed by id so testing one key
  // never clears the verdict shown against another.
  const mounted = useMounted();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  // The provider's live model list per key, filled by a Test -- which is
  // what "Change model" runs first, so the picker only ever offers models
  // that key can actually reach.
  const [modelLists, setModelLists] = useState<Record<string, string[]>>({});
  const [savingModelId, setSavingModelId] = useState<string | null>(null);

  async function handleChooseModel(key: StoredApiKey, model: string) {
    setSavingModelId(key.id);
    try {
      const res = await fetch(`/api/ai-keys/${key.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const body = (await res.json().catch(() => null)) as (StoredApiKey & { error?: string }) | null;
      if (!res.ok || !body) {
        setTestResults((prev) => ({ ...prev, [key.id]: { ok: false, message: body?.error ?? "Couldn't change the model." } }));
        return;
      }
      onKeysChange((prev) => prev.map((k) => (k.id === key.id ? body : k)));
      setTestResults((prev) => ({ ...prev, [key.id]: { ok: true, message: `Now using ${model}.` } }));
    } finally {
      setSavingModelId(null);
    }
  }

  async function handleDelete(key: StoredApiKey) {
    if (!confirm(`Remove this ${PROVIDER_LABELS[key.provider]} key? You can add it again later.`)) {
      return;
    }
    const res = await fetch(`/api/ai-keys/${key.id}`, { method: "DELETE" });
    if (!res.ok) {
      onError("Couldn't remove that key.");
      return;
    }
    onKeysChange((prev) => prev.filter((k) => k.id !== key.id));
  }

  async function handleToggleActive(key: StoredApiKey) {
    const res = await fetch(`/api/ai-keys/${key.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !key.is_active }),
    });
    if (!res.ok) {
      onError("Couldn't change that key.");
      return;
    }
    const updated = (await res.json()) as StoredApiKey;
    onKeysChange((prev) => prev.map((k) => (k.id === key.id ? updated : k)));
  }

  // Re-checks a stored key against its provider without spending a question.
  // A key revoked at the provider otherwise stays listed as usable until an
  // answer fails through it.
  async function handleTestKey(key: StoredApiKey) {
    setTestingId(key.id);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[key.id];
      return next;
    });

    try {
      const res = await fetch(`/api/ai-keys/${key.id}/test`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; message?: string; error?: string; model?: string; models?: string[] }
        | null;

      if (body?.models) setModelLists((prev) => ({ ...prev, [key.id]: body.models! }));
      if (body?.model) {
        onKeysChange((prev) => prev.map((k) => (k.id === key.id ? { ...k, model: body.model! } : k)));
      }

      if (!res.ok && !body?.message) {
        setTestResults((prev) => ({
          ...prev,
          [key.id]: { ok: false, message: body?.error ?? "Couldn't check that key." },
        }));
        return;
      }

      const ok = body?.ok === true;
      setTestResults((prev) => ({
        ...prev,
        [key.id]: { ok, message: body?.message ?? (ok ? "Working." : "That key didn't work.") },
      }));

      // A rejected key is switched off server-side; mirror that here so the
      // row doesn't keep claiming it is on. (A missing model is not a
      // rejection: that key stays on and the picker below fixes it.)
      if (!ok && (body as { state?: string } | null)?.state === "rejected") {
        onKeysChange((prev) => prev.map((k) => (k.id === key.id ? { ...k, is_active: false } : k)));
      }
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [key.id]: { ok: false, message: "Couldn't reach the server. Check your connection." },
      }));
    } finally {
      setTestingId(null);
    }
  }

  return (
    <Card hoverable={false} className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {keys.map((k) => (
          <li
            key={k.id}
            className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 dark:border-subtle px-3 py-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm text-zinc-900 dark:text-zinc-100">
                  {PROVIDER_LABELS[k.provider]}
                  {k.label && <span className="ml-2 text-xs text-zinc-500">{k.label}</span>}
                </span>
                <span className="ml-2 font-mono text-xs text-zinc-500">•••• {k.last_four}</span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-500" title="The model this key asks">
                  {k.model ?? PROVIDER_MODELS[k.provider]}
                  {/* When this key last went to its provider: a use the user
                      didn't make is the first sign of a problem. After mount
                      only -- "x min ago" differs between server and browser. */}
                  {mounted && <span className="font-sans"> · {lastUsed(k.last_used_at)}</span>}
                </span>
                {!k.is_active && (
                  // A key the provider rejected is switched off automatically,
                  // so this label is often the first sign of a revoked key --
                  // but it looks identical to one the user turned off on
                  // purpose. Say so, and point at Test as the way to tell.
                  <span
                    title="Either you turned this off, or the provider rejected it. Test it to find out."
                    className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500"
                  >
                    off — test to check
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  onClick={() => handleTestKey(k)}
                  disabled={testingId === k.id}
                  title="Check this key against the provider without asking a question"
                  className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                >
                  {testingId === k.id ? "Testing…" : "Test"}
                </button>
                {!modelLists[k.id] && (
                  <button
                    onClick={() => handleTestKey(k)}
                    disabled={testingId === k.id}
                    title="Load the models this key can use and pick one"
                    className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                  >
                    Change model
                  </button>
                )}
                <button
                  onClick={() => handleToggleActive(k)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  {k.is_active ? "Turn off" : "Turn on"}
                </button>
                <button
                  onClick={() => handleDelete(k)}
                  title="Remove key"
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            {modelLists[k.id] && modelLists[k.id].length > 0 && (
              <label className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                Model
                <select
                  value={k.model ?? PROVIDER_MODELS[k.provider]}
                  disabled={savingModelId === k.id}
                  onChange={(e) => handleChooseModel(k, e.target.value)}
                  className="min-w-0 max-w-full flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-900 dark:border-subtle dark:bg-zinc-900 dark:text-zinc-100"
                >
                  {!modelLists[k.id].includes(k.model ?? PROVIDER_MODELS[k.provider]) && (
                    <option value={k.model ?? PROVIDER_MODELS[k.provider]} disabled>
                      {k.model ?? PROVIDER_MODELS[k.provider]} (no longer offered)
                    </option>
                  )}
                  {modelLists[k.id].map((m, i) => (
                    <option key={m} value={m}>
                      {m}
                      {i === 0 ? " (recommended)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {testResults[k.id] && (
              <p
                role="status"
                className={`text-xs ${testResults[k.id].ok ? "text-profit" : "text-loss"}`}
              >
                {testResults[k.id].message}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="border-t border-zinc-200 dark:border-subtle pt-4">
        <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Add another key
        </h3>
        <KeyForm onAdded={onAdded} compact />
      </div>
    </Card>
  );
}
