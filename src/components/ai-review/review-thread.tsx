"use client";

import { useState } from "react";
import { MessageSquareReply } from "lucide-react";
import type { AIProviderName } from "@/lib/ai-keys/types";
import type { TradeReviewContent } from "@/lib/ai-reviews/schema";
import { MAX_MESSAGE_CHARS, type ReviewMessage, type ReviewVersion, type Verdict } from "@/lib/ai-reviews/thread-types";
import { NETWORK_FAILURE } from "@/lib/api/failure-message";

// "Explain a decision or push back" under a trade review (0071). The trader
// writes why they did something; the AI says whether that holds up, and when
// it changes its mind the review above is revised (the panel shows versions).

const VERDICT_TEXT: Record<Verdict, { label: string; tone: string }> = {
  convinced: { label: "You convinced it", tone: "text-profit" },
  partly: { label: "Partly convinced", tone: "text-amber-600 dark:text-amber-400" },
  not_convinced: { label: "Not convinced", tone: "text-zinc-500" },
};

export function ReviewThread({
  reviewId,
  keyId,
  messages: initialMessages,
  onRevised,
  onNeedsConsent,
}: {
  reviewId: string;
  /** The key the reply runs on (the panel's selected key). */
  keyId: string | null;
  messages: ReviewMessage[];
  /** A reply revised the review: the new content and the full version list. */
  onRevised: (review: { content: TradeReviewContent; provider: AIProviderName; model: string }, versions: ReviewVersion[]) => void;
  onNeedsConsent: () => void;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || !keyId || sending) return;
    setSending(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/ai-reviews/${reviewId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId, message }),
      });
    } catch {
      setSending(false);
      setError(NETWORK_FAILURE);
      return;
    }
    setSending(false);
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      needsConsent?: AIProviderName;
      messages?: ReviewMessage[];
      versions?: ReviewVersion[];
      review?: { content: TradeReviewContent; provider: AIProviderName; model: string } | null;
    } | null;
    if (!res.ok || !body?.messages) {
      if (body?.needsConsent) {
        onNeedsConsent();
        setError("Confirm sending this trade to the provider above, then press Send again.");
        return;
      }
      setError(body?.error ?? "Couldn't send that. Try again.");
      return;
    }
    setMessages(body.messages);
    setDraft("");
    if (body.review && body.versions) onRevised(body.review, body.versions);
  }

  return (
    <section aria-label="Discuss this review" className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-subtle">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <MessageSquareReply className="h-3.5 w-3.5" strokeWidth={2} />
        Explain a decision or push back
      </h3>
      {messages.length === 0 && (
        <p className="text-xs text-zinc-500">
          Tell it why you did something (&ldquo;I exited early because earnings were the next morning&rdquo;). It says
          whether that holds up, and if you convince it, it revises the review. It won&apos;t change its mind just because
          you insist.
        </p>
      )}

      {messages.length > 0 && (
        <ol className="flex flex-col gap-2.5" data-testid="review-thread">
          {messages.map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex justify-end">
                <p className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100">
                  {m.content}
                </p>
              </li>
            ) : (
              <li key={m.id} className="flex flex-col gap-1">
                {m.verdict && (
                  <span className={`text-[11px] font-semibold uppercase tracking-wide ${VERDICT_TEXT[m.verdict].tone}`}>
                    {VERDICT_TEXT[m.verdict].label}
                    {m.version_after != null && ` · review updated to version ${m.version_after}`}
                  </span>
                )}
                <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{m.content}</p>
              </li>
            ),
          )}
        </ol>
      )}

      <form onSubmit={send} className="flex flex-col gap-2">
        <label htmlFor={`thread-${reviewId}`} className="sr-only">
          Your explanation
        </label>
        <textarea
          id={`thread-${reviewId}`}
          rows={2}
          maxLength={MAX_MESSAGE_CHARS}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending}
          placeholder="Why did you do it that way?"
          className="field-sizing-content min-h-[3.25rem] max-h-64 w-full resize-none rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-primary disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!draft.trim() || !keyId || sending}
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 dark:text-zinc-950"
          >
            {sending ? "Thinking it over…" : "Send"}
          </button>
          {error && (
            <span role="alert" className="text-xs text-loss">
              {error}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
