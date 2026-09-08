"use client";

import { useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { PROVIDER_LABELS, type AIProviderName, type StoredApiKey } from "@/lib/ai-keys/types";
import { Card } from "@/components/ui/Card";
import { ProviderConsentCard } from "@/components/ai/provider-consent-card";
import { KeyForm } from "./key-form";
import { AnswerText } from "./answer-text";
import type { ChatTurn } from "@/lib/ai-keys/providers/types";

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
  // The conversation so far, oldest first. Replaced the single `answer`
  // string: every question used to wipe the previous answer and be sent with
  // no memory of it, so "why?" or "break that down" were unanswerable -- the
  // model had never seen what it had just said.
  const [turns, setTurns] = useState<ChatTurn[]>([]);
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
    const asked = question.trim();
    setAsking(true);
    setError(null);

    // History is what the thread held *before* this question. Captured here
    // rather than read after the optimistic append below, so the question
    // never appears twice in the same request.
    const history = turns;

    // Shown immediately, and the box cleared, so a long answer doesn't leave
    // the question sitting in the textarea looking unsent.
    setTurns((prev) => [...prev, { role: "user", content: asked }]);
    setQuestion("");

    let res: Response;
    try {
      res = await fetch("/api/ask-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: asked, keyId: selected?.id, history }),
      });
    } catch {
      setAsking(false);
      // Roll the optimistic turn back and hand the text back to the user,
      // otherwise a dropped connection silently eats what they typed.
      setTurns(history);
      setQuestion(asked);
      setError("Couldn't reach the server. Check your connection and try again.");
      return;
    }
    setAsking(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setTurns(history);
      setQuestion(asked);
      setError(body?.error ?? "Couldn't get an answer.");
      return;
    }
    const body = (await res.json()) as { answer: string };
    setTurns((prev) => [...prev, { role: "assistant", content: body.answer }]);
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
        <ProviderConsentCard
          provider={selected!.provider}
          description="To answer, your whole trading journal goes with the question: your performance
            statistics and every position you hold. Tickers, prices, sizes, dates, your
            strategies, and everything you wrote in your own fields and notes. Follow-up
            questions send the earlier messages in the conversation too, so the answers
            can build on each other."
          saving={savingConsent}
          onAccept={acceptDisclosure}
          onCancel={() => setPendingDisclosure(false)}
        />
      )}

      {turns.length > 0 && (
        <div className="flex flex-col gap-3">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100">
                  {turn.content}
                </p>
              </div>
            ) : (
              <Card key={i} hoverable={false} className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                  {selected && PROVIDER_LABELS[selected.provider]} answered
                </p>
                {/* AnswerText builds React elements from the string -- it never
                    touches dangerouslySetInnerHTML, so provider output
                    (untrusted text, just round-tripped through a third party)
                    still cannot inject markup here. */}
                <AnswerText text={turn.content} />
              </Card>
            ),
          )}
          {asking && (
            <p role="status" className="text-sm text-zinc-500">
              Thinking...
            </p>
          )}
          <button
            type="button"
            onClick={() => setTurns([])}
            className="self-start text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Start a new conversation
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          rows={3}
          placeholder={
            turns.length > 0
              ? "Ask a follow-up. It remembers what you just discussed."
              : "Ask anything about your trading. Which setup is actually losing me money?"
          }
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
            {asking ? "Thinking..." : turns.length > 0 ? "Send" : "Ask"}
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
        <Card hoverable={false} role="alert" className="border-red-500/40 text-sm text-loss">
          {error}
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
