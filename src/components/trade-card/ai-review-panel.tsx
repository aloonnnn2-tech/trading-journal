"use client";

import { useState } from "react";
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
}: {
  tradeId: string;
  isClosed: boolean;
  isInvestment: boolean;
  isPaid: boolean;
  keys: StoredApiKey[];
  initialConsents: AIProviderName[];
  initialReview: StoredReview<TradeReviewContent> | null;
  initialStale: boolean;
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

  // Only active keys can produce a review -- the route ignores parked ones, so
  // offering them here would only produce a confusing error.
  const usableKeys = keys.filter((k) => k.is_active);
  const selected = usableKeys.find((k) => k.id === selectedId) ?? usableKeys[0];

  async function generate() {
    if (!selected) return;
    setRunning(true);
    setError(null);

    const res = await fetch("/api/ai-reviews/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradeId, keyId: selected.id }),
    });
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
    void generate();
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
        <Link href="/#pricing" className="text-sm text-primary hover:underline">
          See plans
        </Link>
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
          onCancel={() => setPendingDisclosure(false)}
        />
      )}

      {review ? (
        <TradeReviewCard
          review={review}
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
