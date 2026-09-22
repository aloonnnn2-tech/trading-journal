"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Square } from "lucide-react";
import { PROVIDER_LABELS, type AIProviderName, type StoredApiKey } from "@/lib/ai-keys/types";
import { describeTier, tierPolicyFor } from "@/lib/ai-keys/tier";
import type { Conversation } from "@/lib/chat/queries";
import type { TurnView } from "@/lib/chat/fold";
import { Card } from "@/components/ui/Card";
import { ProviderConsentCard } from "@/components/ai/provider-consent-card";
import { KeyForm } from "./key-form";
import { KeyManager } from "./key-manager";
import { ConversationList } from "./conversation-list";
import { MessageList } from "./message-list";
import { useChatStream } from "./use-chat-stream";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

// What the user agrees to before a provider sees anything. This replaces the
// per-question wording: the chat persists conversations and lets the model
// look up anything in the journal. Consent to the old shape does not cover
// this, hence the separate "chat_v2" scope. It describes what ships today
// only -- screenshots and suggested edits are later phases, and each will
// get its own line here (and, if it widens what a provider sees, a new
// scope) when it lands, not before.
const CHAT_DISCLOSURE =
  "To answer, this provider gets live, read-only access to your journal through lookups scoped to " +
  "each question: trades, prices, notes, custom fields, strategies and rules, cash movements, goals, " +
  "mistakes, analytics reports and your past AI reviews — whatever it decides it needs. It cannot " +
  "change anything. Earlier messages in a conversation are re-sent with every turn, and conversations " +
  "are saved to your account until you delete them.";

export function ChatShell({
  initialKeys,
  initialConsents,
  initialConversations,
  initialConversation,
  initialTurns,
}: {
  initialKeys: StoredApiKey[];
  /** Providers consented to under the CHAT scope. */
  initialConsents: AIProviderName[];
  initialConversations: Conversation[];
  initialConversation: Conversation | null;
  initialTurns: TurnView[];
}) {
  const router = useRouter();
  const [keys, setKeys] = useState(initialKeys);
  const [consents, setConsents] = useState<AIProviderName[]>(initialConsents);
  const [conversations, setConversations] = useState(initialConversations);
  const [active, setActive] = useState<Conversation | null>(initialConversation);
  const [selectedKeyId, setSelectedKeyId] = useState(
    initialConversation?.key_id ?? initialKeys.find((k) => k.is_active)?.id ?? "",
  );
  const [question, setQuestion] = useState("");
  const [uiError, setUiError] = useState<string | null>(null);
  const [managingKeys, setManagingKeys] = useState(false);
  const [pendingDisclosure, setPendingDisclosure] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [creating, setCreating] = useState(false);
  const pendingSendRef = useRef<string | null>(null);
  // A second Enter while the first message's conversation is still being
  // created used to start a second conversation: `creating` is React state
  // and had not re-rendered yet. The ref is read synchronously.
  const creatingRef = useRef(false);

  // Only active keys can answer; parked ones would just produce an error.
  const usableKeys = keys.filter((k) => k.is_active);
  const selected = usableKeys.find((k) => k.id === selectedKeyId) ?? usableKeys[0];
  const provider = active?.provider ?? selected?.provider;
  const policy = provider ? tierPolicyFor(provider) : tierPolicyFor("groq");

  const refreshList = useCallback(async () => {
    const res = await fetch("/api/chat/conversations");
    if (!res.ok) return;
    const body = (await res.json()) as { items: Conversation[] };
    setConversations(body.items);
    setActive((cur) => body.items.find((c) => c.id === cur?.id) ?? cur);
  }, []);

  const chat = useChatStream({
    conversationId: active?.id ?? null,
    autoRounds: policy.autoRounds,
    initialTurns,
    onTurnComplete: refreshList,
  });

  // A conversation opened from the rail: load its rows and swap the URL so
  // refresh lands back here. Server-rendered on first load; fetched after.
  const openConversation = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/chat/conversations/${id}`);
      if (!res.ok) {
        setUiError("Couldn't open that conversation.");
        return;
      }
      const body = (await res.json()) as { conversation: Conversation; turns: TurnView[] };
      setActive(body.conversation);
      if (body.conversation.key_id) setSelectedKeyId(body.conversation.key_id);
      chat.reset(body.turns);
      router.replace(`/ask?c=${id}`);
    },
    [chat, router],
  );

  const startNew = useCallback(() => {
    setActive(null);
    chat.reset([]);
    router.replace("/ask");
  }, [chat, router]);

  async function deleteConversation(id: string) {
    if (!confirm("Delete this conversation? This can't be undone.")) return;
    const res = await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setUiError("Couldn't delete that conversation.");
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (active?.id === id) startNew();
  }

  // Creating happens lazily on the first send, so an abandoned "New
  // conversation" click never leaves an empty row behind.
  async function ensureConversation(): Promise<Conversation | null> {
    if (active) return active;
    if (!selected) return null;
    creatingRef.current = true;
    setCreating(true);
    try {
      const res = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: selected.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setUiError(body?.error ?? "Couldn't start a conversation.");
        return null;
      }
      const created = (await res.json()) as Conversation;
      setActive(created);
      router.replace(`/ask?c=${created.id}`);
      return created;
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  async function sendMessage(text: string) {
    const conv = await ensureConversation();
    if (!conv) {
      // Nothing was sent; give the words back rather than losing them.
      setQuestion((cur) => (cur === "" ? text : cur));
      return;
    }
    // Pass the id explicitly: `active` may have been set this same tick and
    // the hook's props won't reflect it until the next render.
    await chat.send(text, conv.id);
    void refreshList();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if (!text || !selected || chat.busy || creatingRef.current) return;
    // Consent is per provider AND per scope (0047). Ask once, with the chat
    // wording, before the first message ever leaves.
    if (!consents.includes(selected.provider)) {
      pendingSendRef.current = text;
      setPendingDisclosure(true);
      return;
    }
    // Cleared here, synchronously, so a second Enter finds an empty box.
    setQuestion("");
    void sendMessage(text);
  }

  // The server can also refuse a turn for want of consent (403 with
  // `needsConsent`): a consent withdrawn on the settings page, or a page
  // rendered before it was recorded. Same card, same wording; on accept the
  // refused message is sent again rather than typed again.
  const serverNeedsConsent = chat.error?.code === "needs_consent" ? chat.error.provider : undefined;
  const disclosureProvider = pendingDisclosure ? selected?.provider : serverNeedsConsent;

  async function acceptDisclosure() {
    const provider = disclosureProvider;
    if (!provider) return;
    setSavingConsent(true);
    const res = await fetch("/api/ai-keys/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, scope: "chat_v2" }),
    });
    setSavingConsent(false);
    if (!res.ok) {
      setUiError("Couldn't record your agreement. Try again.");
      return;
    }
    setConsents((prev) => (prev.includes(provider) ? prev : [...prev, provider]));
    if (serverNeedsConsent) {
      chat.clearError();
      void chat.resend();
      return;
    }
    setPendingDisclosure(false);
    const text = pendingSendRef.current;
    pendingSendRef.current = null;
    if (text) {
      setQuestion("");
      void sendMessage(text);
    }
  }

  // Stream errors and UI errors share one card; derived, not synced, so
  // there is no effect to fall out of step. A consent refusal is shown as
  // the disclosure card instead, never as an error.
  const shownError = uiError ?? (serverNeedsConsent ? null : (chat.error?.message ?? null));

  // ---- No keys yet: setup is the whole page ----------------------------
  if (keys.length === 0) {
    return (
      <Card hoverable={false} className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Connect an AI provider</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Questions run on your own API key, billed to your own provider account. Nothing is charged
            by this app.
          </p>
        </div>
        <KeyForm
          onAdded={(created) => {
            setKeys((prev) => [...prev, created]);
            setSelectedKeyId(created.id);
          }}
        />
      </Card>
    );
  }

  const providerLabel = provider ? PROVIDER_LABELS[provider] : "The model";
  const tierLine = provider ? describeTier(provider, PROVIDER_LABELS[provider]) : null;

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      <ConversationList
        items={conversations}
        activeId={active?.id ?? null}
        busy={chat.busy || creating}
        onSelect={(id) => void openConversation(id)}
        onNew={startNew}
        onDelete={(id) => void deleteConversation(id)}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {disclosureProvider && (
          <ProviderConsentCard
            provider={disclosureProvider}
            description={CHAT_DISCLOSURE}
            saving={savingConsent}
            onAccept={acceptDisclosure}
            onCancel={() => {
              setPendingDisclosure(false);
              pendingSendRef.current = null;
              if (serverNeedsConsent) chat.clearError();
            }}
          />
        )}

        <MessageList
          turns={chat.turns}
          phase={chat.phase}
          providerLabel={providerLabel}
          needsContinue={chat.needsContinue}
          onKeepGoing={() => void chat.keepGoing()}
          onResume={() => void chat.resume()}
        />

        {/* Every key is switched off -- the state that disables Send. Say why. */}
        {usableKeys.length === 0 && (
          <Card hoverable={false} className="flex flex-col items-start gap-2 border-amber-500/40">
            <p className="text-sm text-zinc-700 dark:text-zinc-200">
              {keys.length === 1
                ? `Your ${PROVIDER_LABELS[keys[0].provider]} key is switched off, so questions can't be sent.`
                : "All your API keys are switched off, so questions can't be sent."}{" "}
              A key is turned off automatically when the provider rejects it — usually because it was
              revoked, rotated, or hit its quota.
            </p>
            <button
              type="button"
              onClick={() => setManagingKeys(true)}
              className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-white dark:text-zinc-950 hover:brightness-110"
            >
              Turn a key back on, or add a new one
            </button>
          </Card>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <textarea
            rows={3}
            placeholder={
              chat.turns.length > 0
                ? "Ask a follow-up. It remembers this conversation."
                : "Ask anything about your trading. Which setup is actually losing me money?"
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
            className={`${inputClass} resize-y`}
          />

          <div className="flex flex-wrap items-center gap-3">
            {chat.busy ? (
              <button
                type="button"
                onClick={chat.stop}
                className="flex items-center gap-1.5 rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <Square className="h-3 w-3" strokeWidth={2.5} />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                data-tour-id="ask-submit"
                disabled={!question.trim() || !selected || creating}
                className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                {chat.turns.length > 0 ? "Send" : "Ask"}
              </button>
            )}

            {/* The key is fixed once a conversation exists -- switching mid-way
                would send one provider's transcript to another. */}
            {!active && usableKeys.length > 1 && (
              <select
                value={selected?.id ?? ""}
                onChange={(e) => setSelectedKeyId(e.target.value)}
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
            {active && <span className="text-xs text-zinc-500">{PROVIDER_LABELS[active.provider]}</span>}

            <button
              type="button"
              onClick={() => setManagingKeys((v) => !v)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              {managingKeys ? "Hide keys" : `Manage keys (${keys.length})`}
            </button>
          </div>

          {tierLine && <p className="text-[11px] text-zinc-500">{tierLine}</p>}
        </form>

        {shownError && (
          <Card hoverable={false} role="alert" className="flex items-start justify-between gap-3 border-red-500/40 text-sm text-loss">
            <span>{shownError}</span>
            <button
              type="button"
              onClick={() => {
                setUiError(null);
                chat.clearError();
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Dismiss
            </button>
          </Card>
        )}

        {managingKeys && (
          <KeyManager
            keys={keys}
            onKeysChange={(update) => setKeys(update)}
            onAdded={(created) => {
              setKeys((prev) => [...prev, created]);
              setSelectedKeyId(created.id);
              setManagingKeys(false);
            }}
            onError={setUiError}
          />
        )}
      </div>
    </div>
  );
}
