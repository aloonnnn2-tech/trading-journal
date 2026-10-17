"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Square } from "lucide-react";
import { PROVIDER_LABELS, type AIProviderName, type StoredApiKey } from "@/lib/ai-keys/types";
import { describeTier, tierPolicyFor } from "@/lib/ai-keys/tier";
import type { Conversation } from "@/lib/chat/queries";
import type { TurnView } from "@/lib/chat/fold";
import { Card } from "@/components/ui/Card";
import { ProviderConsentCard } from "@/components/ai/provider-consent-card";
import { SCREENSHOT_AI_PROVIDERS } from "@/lib/ocr/ai-providers";
import { ModelPicker } from "./model-picker";
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
// only. Chart screenshots widen what a provider sees, so they have their own
// switch and wording (CHART_DISCLOSURE, scope "chat_images_v1").
const CHAT_DISCLOSURE =
  "To answer, this provider gets live, read-only access to your journal through lookups scoped to " +
  "each question: trades, prices, notes, custom fields, strategies and rules, cash movements, goals, " +
  "mistakes, analytics reports and your past AI reviews — whatever it decides it needs. It cannot " +
  "change anything itself: it can suggest a change, which happens only if you press Apply on it. " +
  "Earlier messages in a conversation are re-sent with every turn, and conversations " +
  "are saved to your account until you delete them.";

const CHART_DISCLOSURE =
  "When a question needs it, Ask can look at your trades' chart screenshots: the image itself is sent " +
  "to this provider, resized and without any location or camera data, each time that question needs " +
  "it. The chat stores only which screenshot it looked at, never the image. Untick the switch to " +
  "stop it at any time.";

export function ChatShell({
  initialKeys,
  initialConsents,
  initialImageConsents,
  initialConversations,
  initialConversation,
  initialTurns,
}: {
  initialKeys: StoredApiKey[];
  /** Providers consented to under the CHAT scope. */
  initialConsents: AIProviderName[];
  /** Providers allowed to see chart screenshots (scope chat_images_v1). */
  initialImageConsents: AIProviderName[];
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
  const [imageConsents, setImageConsents] = useState<AIProviderName[]>(initialImageConsents);
  const [askingChartConsent, setAskingChartConsent] = useState(false);
  const [savingChartConsent, setSavingChartConsent] = useState(false);
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
  // The key whose model the picker shows: the conversation's own key once
  // one exists (it is fixed for that conversation), else the selected one.
  const pickerKey = active ? keys.find((k) => k.id === active.key_id) : selected;
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

  // Follow a streaming answer down the page -- but only while the reader is
  // already at the bottom. Someone who scrolled up to re-read an earlier
  // answer must not be yanked back down by every new word.
  const endRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      followRef.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (followRef.current && chat.turns.length > 0) endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.turns, chat.phase]);

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

  // Chart screenshots: a switch per provider. On asks first, with its own
  // wording; off withdraws the agreement straight away.
  const canSeeCharts = provider ? SCREENSHOT_AI_PROVIDERS.has(provider) : false;
  const chartsOn = provider ? imageConsents.includes(provider) : false;

  async function setChartAccess(on: boolean) {
    if (!provider) return;
    setSavingChartConsent(true);
    const res = await fetch("/api/ai-keys/consent", {
      method: on ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, scope: "chat_images_v1" }),
    });
    setSavingChartConsent(false);
    if (!res.ok) {
      setUiError(on ? "Couldn't switch chart viewing on. Try again." : "Couldn't switch chart viewing off. Try again.");
      return;
    }
    setImageConsents((prev) => (on ? [...prev.filter((p) => p !== provider), provider] : prev.filter((p) => p !== provider)));
    setAskingChartConsent(false);
  }

  // Stream errors and UI errors share one card; derived, not synced, so
  // there is no effect to fall out of step. A consent refusal is shown as
  // the disclosure card instead, never as an error.
  const shownError = uiError ?? (serverNeedsConsent ? null : (chat.error?.message ?? null));

  // ---- No keys yet: setup is the whole page ----------------------------
  if (keys.length === 0) {
    return (
      <Card hoverable={false} className="mx-auto flex w-full max-w-3xl flex-col gap-4">
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
    <div className="flex flex-1 flex-col gap-4 md:flex-row md:gap-6">
      <ConversationList
        items={conversations}
        activeId={active?.id ?? null}
        busy={chat.busy || creating}
        onSelect={(id) => void openConversation(id)}
        onNew={startNew}
        onDelete={(id) => void deleteConversation(id)}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {chat.turns.length === 0 && !disclosureProvider && <EmptyState onPick={(q) => setQuestion(q)} />}

        <MessageList
          turns={chat.turns}
          phase={chat.phase}
          providerLabel={providerLabel}
          needsContinue={chat.needsContinue}
          onKeepGoing={() => void chat.keepGoing()}
          onResume={() => void chat.resume()}
        />

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

        {askingChartConsent && provider && (
          <ProviderConsentCard
            provider={provider}
            description={CHART_DISCLOSURE}
            saving={savingChartConsent}
            onAccept={() => void setChartAccess(true)}
            onCancel={() => setAskingChartConsent(false)}
          />
        )}

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

        {/* The anchor auto-scroll keeps in view while an answer streams. */}
        <div ref={endRef} aria-hidden />

        {/* Pinned to the bottom of the window, like every chat app: the
            conversation scrolls behind it and the box never leaves reach.
            mt-auto pushes it down while the conversation is still short. */}
        <form
          onSubmit={handleSubmit}
          className="sticky bottom-[var(--tabbar-h)] z-10 mt-auto flex flex-col gap-2 border-t border-zinc-200 bg-zinc-50/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-subtle dark:bg-zinc-950/95"
        >
          <textarea
            rows={2}
            placeholder={
              chat.turns.length > 0
                ? "Ask a follow-up. It remembers this conversation."
                : "Ask anything. Which setup is losing me money? What do you think of NVDA here?"
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
            // Grows with what is typed, up to a third of the window.
            className={`${inputClass} field-sizing-content min-h-[3.25rem] max-h-[33dvh] resize-none text-[15px]`}
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
                className="min-w-0 max-w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary"
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
            {pickerKey && (
              <ModelPicker
                apiKey={pickerKey}
                onKeyChange={(updated) => setKeys((prev) => prev.map((k) => (k.id === updated.id ? updated : k)))}
              />
            )}

            {canSeeCharts && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input
                  type="checkbox"
                  checked={chartsOn}
                  disabled={savingChartConsent}
                  onChange={(e) => {
                    if (e.target.checked) setAskingChartConsent(true);
                    else void setChartAccess(false);
                  }}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Let Ask see my chart screenshots
              </label>
            )}

            <button
              type="button"
              onClick={() => setManagingKeys((v) => !v)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              {managingKeys ? "Hide keys" : `Manage keys (${keys.length})`}
            </button>

            {tierLine && <p className="hidden text-[11px] text-zinc-500 lg:ml-auto lg:block">{tierLine}</p>}
          </div>
        </form>
      </div>
    </div>
  );
}

// Starting points for an empty conversation. Questions only -- they claim
// nothing about the user's journal, and picking one just fills the box.
const EXAMPLE_QUESTIONS = [
  "Which setup is making me the most money, and which is losing it?",
  "What do my worst trades this month have in common?",
  "Am I cutting winners too early? Check my exits against my targets.",
  "How does my win rate change by day of the week?",
];

function EmptyState({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-sm text-zinc-500">Not sure where to start? Pick one and edit it before sending.</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm text-zinc-700 transition-colors hover:border-primary/50 hover:text-zinc-900 dark:border-subtle dark:bg-card dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
