"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { PROVIDER_LABELS, type StoredApiKey } from "@/lib/ai-keys/types";
import { Card } from "@/components/ui/Card";
import { KeyForm } from "./key-form";

// The stored-key list: test, switch on/off, remove, add another. Lifted out
// of the old ask-manager unchanged so the chat shell stays about the
// conversation. `keys` is owned by the parent -- the composer's key picker
// and the "all keys off" notice read the same list.
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
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

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
        | { ok?: boolean; message?: string; error?: string }
        | null;

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
      // row doesn't keep claiming it is on.
      if (!ok) {
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
