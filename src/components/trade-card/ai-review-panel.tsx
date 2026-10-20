"use client";

import { useRef, useState } from "react";
import { FormError } from "@/components/form-error";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ProviderConsentCard } from "@/components/ai/provider-consent-card";
import { TradeReviewCard } from "@/components/ai-review/trade-review-card";
import { tradeReviewToText } from "@/components/ai-review/to-text";
import { PROVIDER_LABELS, type AIProviderName, type StoredApiKey } from "@/lib/ai-keys/types";
import type { TradeReviewContent } from "@/lib/ai-reviews/schema";
import type { StoredReview } from "@/lib/ai-reviews/types";
import type { ReviewThread as ReviewThreadData } from "@/lib/ai-reviews/thread-types";
import { ReviewThread } from "@/components/ai-review/review-thread";

import { SeePlansButton } from "@/components/plans/SeePlansButton";
import { signalReviewWow } from "@/lib/reviews/signals";
import { NETWORK_FAILURE } from "@/lib/api/failure-message";
// The AI Trade Review entry point, rendered as a sibling of the trade card
// rather than inside it. TradeCard is a 900-line form with its own autosave
// lifecycle; a panel that only reads the trade id has no business being
// entangled with it.
//
// All four states this can be in are reachable from a cold load, so each one
// is rendered from props the server already resolved -- plan, keys, consents
// and any saved review. Fetching them on mount instead would flash the
// paywall at paying users on every page load.

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <Card standalone={false} className="flex flex-col gap-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
        AI Trade Review
      </h2>
      {children}
    </Card>
  );
}

export function AiReviewPanel({
  tradeId,
  isClosed,
  isInvestment,
  isPaid,
  keys,
  initialConsents,
  initialReview,
  initialStale,
  initialThread = { available: false, messages: [], versions: [] },
}: {
  tradeId: string;
  isClosed: boolean;
  isInvestment: boolean;
  isPaid: boolean;
  keys: StoredApiKey[];
  initialConsents: AIProviderName[];
  initialReview: StoredReview<TradeReviewContent> | null;
  initialStale: boolean;
  /** The discussion under the review and its versions (0071). */
  initialThread?: ReviewThreadData;
}) {
  const router = useRouter();
  const [review, setReview] = useState(initialReview);
  const [stale, setStale] = useState(initialStale);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consents, setConsents] = useState(initialConsents);
  const [pendingDisclosure, setPendingDisclosure] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);
  const [selectedId, setSelectedId] = useState(keys.find((k) => k.is_active)?.id ?? "");
  const [thread, setThread] = useState(initialThread);
  // Which version is on screen; null = the current one.
  const [viewing, setViewing] = useState<number | null>(null);
  // The consent card can be opened by the discussion too, which must not
  // regenerate the review when it's accepted.
  const consentForRef = useRef<"generate" | "thread">("generate");

  // Only active keys can produce a review -- the route ignores parked ones, so
  // offering them here would only produce a confusing error.
  const usableKeys = keys.filter((k) => k.is_active);
  const selected = usableKeys.find((k) => k.id === selectedId) ?? usableKeys[0];

  async function generate() {
    if (!selected) return;
    setRunning(true);
    setError(null);

    let res: Response;
    try {
      res = await fetch("/api/ai-reviews/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId, keyId: selected.id }),
      });
    } catch {
      setRunning(false);
      setError(NETWORK_FAILURE);
      return;
    }
    setRunning(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        needsConsent?: AIProviderName;
      } | null;
      // The server is the authority on consent, not this component's props: a
      // tab left open since before consent was withdrawn lands here.
      if (body?.needsConsent) {
        setPendingDisclosure(true);
        return;
      }
      setError(body?.error ?? "Couldn't generate a review.");
      return;
    }

    const body = (await res.json()) as { review: StoredReview<TradeReviewContent> };
    setReview(body.review);
    // A regenerated review starts a fresh discussion (the route cleared it).
    setThread((t) => ({ ...t, messages: [], versions: [] }));
    setViewing(null);
    signalReviewWow("wow_ai_review");
    // Freshly generated against the trade as it is right now.
    setStale(false);
    // Regenerating swaps the card's prose for new prose, which on its own is
    // easy to miss. A brief confirmation is the only signal the click landed.
    setJustGenerated(true);
    setTimeout(() => setJustGenerated(false), 3000);
    // The review is already saved server-side, but this page was rendered
    // before it existed -- so its cached payload still says there is none.
    // Without this the review survives until the next navigation that reuses
    // that payload (browser Back always does, whatever the stale time) and
    // then vanishes, looking exactly like it was never stored. Same reason
    // trade-history-panel refreshes after a restore.
    router.refresh();
  }

  async function acceptDisclosure() {
    if (!selected) return;
    setSavingConsent(true);
    let res: Response;
    try {
      res = await fetch("/api/ai-keys/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selected.provider }),
      });
    } catch {
      setSavingConsent(false);
      setError(NETWORK_FAILURE);
      return;
    }
    setSavingConsent(false);

    if (!res.ok) {
      setError("Couldn't record your agreement. Try again.");
      return;
    }
    setConsents((prev) => [...prev, selected.provider]);
    setPendingDisclosure(false);
    if (consentForRef.current === "generate") void generate();
    consentForRef.current = "generate";
  }

  async function handleDelete() {
    if (!review) return;
    if (!confirm("Delete this review? Your trade is not affected.")) return;

    const res = await fetch(`/api/ai-reviews/${review.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Couldn't delete that review.");
      return;
    }
    setReview(null);
    setError(null);
    // Symmetrically: drop the review from the server payload too, or a cached
    // navigation brings the deleted review back.
    router.refresh();
  }

  async function handleCopy() {
    if (!review) return;
    try {
      await navigator.clipboard.writeText(tradeReviewToText(review.content));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Your browser blocked clipboard access.");
    }
  }

  // ---- States that can't generate ----------------------------------------

  if (!isPaid) {
    return (
      <PanelShell>
        <p className="text-sm text-zinc-500">
          Have this trade analysed for execution quality. What you did well, what to fix, and
          how it compares with your own history. Available on the paid plan.
        </p>
        <SeePlansButton feature="trade-review" />
      </PanelShell>
    );
  }

  if (isInvestment) {
    return (
      <PanelShell>
        <p className="text-sm text-zinc-500">
          Trade reviews cover trades. Investment-mode positions don&apos;t carry realised P&amp;L,
          so there&apos;s no execution to score.
        </p>
      </PanelShell>
    );
  }

  if (!isClosed) {
    return (
      <PanelShell>
        <p className="text-sm text-zinc-500">
          Available once this trade is closed. A review judges how it was managed all the way
          out, including the exit.
        </p>
      </PanelShell>
    );
  }

  if (usableKeys.length === 0) {
    return (
      <PanelShell>
        <p className="text-sm text-zinc-500">
          AI reviews run on your own API key. Free options available. Add one on the{" "}
          <Link href="/ask" className="text-primary hover:underline">
            Ask page
          </Link>{" "}
          to use Trade Review. Nothing is charged by this app.
        </p>
      </PanelShell>
    );
  }

  // ---- Ready ---------------------------------------------------------------

  const consented = selected ? consents.includes(selected.provider) : false;

  return (
    <PanelShell>
      {pendingDisclosure && selected && (
        <ProviderConsentCard
          provider={selected.provider}
          description="This trade goes with the request: its prices, size, dates, your own notes and
            fields on it, plus summary statistics from your other closed trades and a few
            comparable past trades, so the review can judge it against your own history."
          saving={savingConsent}
          onAccept={acceptDisclosure}
          onCancel={() => {
            setPendingDisclosure(false);
            consentForRef.current = "generate";
          }}
        />
      )}

      {review ? (
        <>
        {thread.versions.length > 1 && (
          <VersionBar
            versions={thread.versions}
            viewing={viewing}
            onView={(v) => setViewing(v === thread.versions[thread.versions.length - 1].version ? null : v)}
          />
        )}
        <TradeReviewCard
          review={
            viewing != null
              ? { ...review, content: thread.versions.find((v) => v.version === viewing)?.content ?? review.content }
              : review
          }
          stale={stale}
          actions={
            <>
              {justGenerated && <span className="text-profit">Review ready</span>}
              <button
                onClick={() => generate()}
                disabled={running}
                className="text-primary hover:underline disabled:opacity-50"
              >
                {running ? "Analyzing..." : "Regenerate"}
              </button>
              <button onClick={handleCopy} className="hover:text-zinc-700 dark:hover:text-zinc-300">
                {copied ? "Copied" : "Copy"}
              </button>
              <button onClick={handleDelete} className="text-loss hover:underline">
                Delete
              </button>
            </>
          }
        />
        {thread.available && (
          <ReviewThread
            key={review.id + review.created_at}
            reviewId={review.id}
            keyId={selected?.id ?? null}
            messages={thread.messages}
            onNeedsConsent={() => {
              consentForRef.current = "thread";
              setPendingDisclosure(true);
            }}
            onRevised={(revised, versions) => {
              setReview((r) => (r ? { ...r, content: revised.content, provider: revised.provider, model: revised.model } : r));
              setThread((t) => ({ ...t, versions }));
              setViewing(null);
              router.refresh();
            }}
          />
        )}
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-500">
            Get this trade analysed for execution quality. Judged on process, not on whether it
            made money, and compared against your own history.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={generate}
              disabled={running || !selected}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              {running ? "Analyzing..." : error ? "Retry" : "AI Review"}
            </button>

            {/* Only worth a picker when there's an actual choice to make. */}
            {usableKeys.length > 1 && (
              <select
                value={selected?.id ?? ""}
                onChange={(e) => setSelectedId(e.target.value)}
                className="rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {usableKeys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {PROVIDER_LABELS[k.provider]}
                    {k.label ? ` · ${k.label}` : ""} · •••• {k.last_four}
                  </option>
                ))}
              </select>
            )}

            {selected && !consented && (
              <span className="text-xs text-zinc-500">
                You&apos;ll be asked to confirm before anything is sent.
              </span>
            )}
          </div>
        </>
      )}

      <FormError className="rounded-lg border border-loss/40 px-3 py-2">{error}</FormError>
    </PanelShell>
  );
}

/** "Version 3 of 3 · what changed" -- shown once a discussion revised the review. */
function VersionBar({
  versions,
  viewing,
  onView,
}: {
  versions: ReviewThreadData["versions"];
  viewing: number | null;
  onView: (version: number) => void;
}) {
  const latest = versions[versions.length - 1];
  const shown = versions.find((v) => v.version === (viewing ?? latest.version)) ?? latest;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-700 dark:text-zinc-200">
          Version {shown.version} of {latest.version}
          {shown.version === latest.version ? " (current)" : ""}
        </span>
        <span className="flex flex-wrap gap-1">
          {versions.map((v) => (
            <button
              key={v.version}
              type="button"
              onClick={() => onView(v.version)}
              aria-pressed={v.version === shown.version}
              className={`rounded-full border px-2 py-0.5 ${
                v.version === shown.version
                  ? "border-primary text-primary"
                  : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              v{v.version}
            </button>
          ))}
        </span>
      </div>
      {shown.changed_because && <p className="text-zinc-600 dark:text-zinc-300">Changed because: {shown.changed_because}</p>}
      {shown.version === 1 && <p className="text-zinc-500">The original review, before the discussion below.</p>}
    </div>
  );
}
