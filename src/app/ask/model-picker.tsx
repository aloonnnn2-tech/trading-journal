"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { PROVIDER_MODELS, type StoredApiKey } from "@/lib/ai-keys/types";
import { chatModels, modelHint } from "@/lib/ai-keys/model-list";
import { NETWORK_FAILURE } from "@/lib/api/failure-message";

// Which model answers, chosen right where you ask (Alon, 2026-10-16: "let
// the user pick which model"). It was already possible under Manage keys ->
// Change model; this puts it beside the box you type in.
//
// The list is the key's own LIVE model list from its provider -- the same
// check the Test button runs, which costs no tokens -- so only models that
// key can actually reach are offered, minus the ones that can't chat
// (model-list.ts). Saving goes through PATCH /api/ai-keys/[id], which checks
// the choice against that list again. It is the key's model, so it applies
// from the next message on, in every conversation on this key.
export function ModelPicker({
  apiKey,
  onKeyChange,
}: {
  apiKey: StoredApiKey;
  onKeyChange: (updated: StoredApiKey) => void;
}) {
  const current = apiKey.model ?? PROVIDER_MODELS[apiKey.provider];
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"loading" | "saving" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setBusy("loading");
    setMessage(null);
    try {
      const res = await fetch(`/api/ai-keys/${apiKey.id}/test`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { models?: string[]; message?: string; error?: string } | null;
      const list = body?.models ? chatModels(body.models) : [];
      if (list.length === 0) {
        setMessage(body?.error ?? body?.message ?? "Couldn't load this key's models.");
        return;
      }
      if (!list.includes(current)) list.unshift(current);
      setModels(list);
    } catch {
      setMessage(NETWORK_FAILURE);
    } finally {
      setBusy(null);
    }
  }

  async function choose(model: string) {
    if (model === current) {
      setModels(null);
      return;
    }
    setBusy("saving");
    setMessage(null);
    try {
      const res = await fetch(`/api/ai-keys/${apiKey.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const body = (await res.json().catch(() => null)) as (StoredApiKey & { error?: string }) | null;
      if (!res.ok || !body) {
        setMessage(body?.error ?? "Couldn't change the model.");
        return;
      }
      onKeyChange(body);
      setModels(null);
    } catch {
      setMessage(NETWORK_FAILURE);
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {models ? (
        <select
          autoFocus
          aria-label="Model"
          value={current}
          disabled={busy === "saving"}
          onChange={(e) => void choose(e.target.value)}
          onBlur={() => busy === null && setModels(null)}
          className="min-w-0 max-w-[16rem] rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1.5 font-mono text-[11px] text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        >
          {models.map((m) => {
            const hint = modelHint(m);
            return (
              <option key={m} value={m}>
                {m}
                {hint ? ` — ${hint}` : ""}
              </option>
            );
          })}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy !== null}
          title="Choose which model answers. Bigger models answer better and cost more on a paid key."
          className="flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 font-mono text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-60 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <span className="truncate">{busy === "loading" ? "Loading models…" : current}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      )}
      {message && (
        <span role="status" className="text-[11px] text-loss">
          {message}
        </span>
      )}
    </span>
  );
}
