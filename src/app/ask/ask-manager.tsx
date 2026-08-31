"use client";

import { useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { PROVIDER_LABELS, type AIProviderName, type StoredApiKey } from "@/lib/ai-keys/types";
import { Card } from "@/components/ui/Card";
import { KeyForm } from "./key-form";
import { AnswerText } from "./answer-text";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

// Consent is recorded per provider on the account (0031), not per browser.
// Agreeing to send your journal to Groq is not agreement to send it to
// OpenAI, and the previous localStorage flag covered the user as a whole --
// so switching providers silently reused an agreement naming a different
// company. It also vanished when site data was cleared and left the app with
// no record that anyone had agreed.

export function AskManager({
  initialKeys,
  initialConsents,
}: {
  initialKeys: StoredApiKey[];
  initialConsents: AIProviderName[];
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [consents, setConsents] = useState<AIProviderName[]>(initialConsents);
  const [selectedId, setSelectedId] = useState(
    initialKeys.find((k) => k.is_active)?.id ?? "",
  );
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managingKeys, setManagingKeys] = useState(false);
  const [pendingDisclosure, setPendingDisclosure] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);

  // Only active keys can answer a question -- the ask endpoint ignores parked
  // ones, so offering them in the picker would just produce a confusing error.
  const usableKeys = keys.filter((k) => k.is_active);
  const selected = usableKeys.find((k) => k.id === selectedId) ?? usableKeys[0];

  function handleAdded(created: StoredApiKey) {
    setKeys((prev) => [...prev, created]);
    setSelectedId(created.id);
    setManagingKeys(false);
  }

  async function handleDelete(key: StoredApiKey) {
    if (!confirm(`Remove this ${PROVIDER_LABELS[key.provider]} key? You can add it again later.`)) {
      return;
    }
    const res = await fetch(`/api/ai-keys/${key.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Couldn't remove that key.");
      return;
    }
    setKeys((prev) => {
      const next = prev.filter((k) => k.id !== key.id);
      if (key.id === selectedId) setSelectedId(next[0]?.id ?? "");
      return next;
    });
  }

  async function runQuestion() {
    setAsking(true);
    setError(null);
    setAnswer(null);

    const res = await fetch("/api/ask-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question.trim(), keyId: selected?.id }),
    });
    setAsking(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't get an answer.");
      return;
    }
    const body = (await res.json()) as { answer: string };
    setAnswer(body.answer);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || !selected || asking) return;

    // Gate on the *selected provider*, so switching to a newly added provider
    // asks again. The check has to come before the request, not alongside it
    // -- the whole point is that the trader agrees before any of their data
    // leaves for that company. The server enforces this too; this dialog is
    // how they're given the chance to agree.
    if (!consents.includes(selected.provider)) {
      setPendingDisclosure(true);
      return;
    }
    void runQuestion();
  }

  async function acceptDisclosure() {
    if (!selected) return;
    setSavingConsent(true);
    const res = await fetch("/api/ai-keys/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: selected.provider }),
    });
    setSavingConsent(false);

    if (!res.ok) {
      setError("Couldn't record your agreement. Try again.");
      return;
    }
    setConsents((prev) => [...prev, selected.provider]);
    setPendingDisclosure(false);
    void runQuestion();
  }

  async function handleToggleActive(key: StoredApiKey) {
    const res = await fetch(`/api/ai-keys/${key.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !key.is_active }),
    });
    if (!res.ok) {
      setError("Couldn't change that key.");
      return;
    }
    const updated = (await res.json()) as StoredApiKey;
    setKeys((prev) => prev.map((k) => (k.id === key.id ? updated : k)));
  }

  // ---- No keys yet: setup is the whole page ----------------------------
  if (keys.length === 0) {
    return (
      <Card hoverable={false} className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Connect an AI provider
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Questions run on your own API key, billed to your own provider account. Nothing is
            charged by this app.
          </p>
        </div>
        <KeyForm onAdded={handleAdded} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {pendingDisclosure && (
        <Card hoverable={false} className="flex flex-col gap-3 border-amber-500/40">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Before your first question
          </h2>
          <p className="text-sm text-zinc-500">
            To answer, your trading journal is sent to{" "}
            <strong className="text-zinc-900 dark:text-zinc-100">
              {PROVIDER_LABELS[selected!.provider]}
            </strong>{" "}
            using your own API key. That includes your performance statistics and every
            position you hold — tickers, prices, sizes, dates, your strategies, and everything
            you wrote in your own fields and notes. That third party processes it under their
            terms, not ours. Your key stays encrypted here and is never shared.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={acceptDisclosure}
              disabled={savingConsent}
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
            >
              {savingConsent ? "Saving..." : "I understand — send it"}
            </button>
            <button
              onClick={() => setPendingDisclosure(false)}
              className="text-sm text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          rows={3}
          placeholder="Ask anything about your trading — e.g. which setup is actually losing me money?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className={`${inputClass} resize-y`}
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            data-tour-id="ask-submit"
            disabled={asking || !question.trim() || !selected}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            {asking ? "Thinking..." : "Ask"}
          </button>

          {/* Only worth a picker when there's an actual choice to make. */}
          {usableKeys.length > 1 && (
            <select
              value={selected?.id ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary"
            >
              {usableKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {PROVIDER_LABELS[k.provider]}
                  {k.label ? ` · ${k.label}` : ""} · •••• {k.last_four}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setManagingKeys((v) => !v)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            {managingKeys ? "Hide keys" : `Manage keys (${keys.length})`}
          </button>
        </div>
      </form>

      {error && (
        <Card hoverable={false} className="border-red-500/40 text-sm text-red-400">
          {error}
        </Card>
      )}

      {answer && (
        <Card hoverable={false} className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            {selected && PROVIDER_LABELS[selected.provider]} answered
          </p>
          {/* AnswerText builds React elements from the string -- it never
              touches dangerouslySetInnerHTML, so provider output (untrusted
              text, just round-tripped through a third party) still cannot
              inject markup here. */}
          <AnswerText text={answer} />
        </Card>
      )}

      {managingKeys && (
        <Card hoverable={false} className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm text-zinc-900 dark:text-zinc-100">
                    {PROVIDER_LABELS[k.provider]}
                    {k.label && <span className="ml-2 text-xs text-zinc-500">{k.label}</span>}
                  </span>
                  <span className="ml-2 font-mono text-xs text-zinc-500">•••• {k.last_four}</span>
                  {!k.is_active && (
                    // A key the provider rejected is switched off automatically,
                    // so this label is often the first sign of a revoked key.
                    <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500">
                      off
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
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
              </li>
            ))}
          </ul>
          <div className="border-t border-zinc-200 dark:border-subtle pt-4">
            <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Add another key
            </h3>
            <KeyForm onAdded={handleAdded} compact />
          </div>
        </Card>
      )}
    </div>
  );
}
