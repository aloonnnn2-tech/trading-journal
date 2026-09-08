"use client";

import { useCallback, useEffect, useState } from "react";
import { FormError } from "@/components/form-error";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ProviderConsentCard } from "@/components/ai/provider-consent-card";
import { PeriodReviewCard } from "@/components/ai-review/period-review-card";
import { periodReviewToText } from "@/components/ai-review/to-text";
import { PROVIDER_LABELS, type AIProviderName, type StoredApiKey } from "@/lib/ai-keys/types";
import type { PeriodReviewContent } from "@/lib/ai-reviews/schema";
import type { PeriodKind, ResolvedPeriod } from "@/lib/ai-reviews/period";
import type { StoredReview } from "@/lib/ai-reviews/types";

type Review = StoredReview<PeriodReviewContent>;

/**
 * Above this many trades, generating asks for confirmation first.
 *
 * The count is always shown on the button, so the user knows the size of
 * every request. This extra step is for the ones big enough to be worth a
 * deliberate "yes" -- it is their own provider quota being spent, and a
 * month of active trading is a materially bigger request than a quiet week.
 */
const CONFIRM_ABOVE_TRADES = 30;

const KIND_LABELS: Record<PeriodKind, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  custom: "Custom range",
};

const inputClass =
  "rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function ReviewsManager({
  keys,
  initialConsents,
  initialReviews,
  initialStaleIds,
}: {
  keys: StoredApiKey[];
  initialConsents: AIProviderName[];
  initialReviews: Review[];
  initialStaleIds: string[];
}) {
  const router = useRouter();
  const [reviews, setReviews] = useState(initialReviews);
  const [staleIds, setStaleIds] = useState(new Set(initialStaleIds));
  const [selectedReviewId, setSelectedReviewId] = useState(initialReviews[0]?.id ?? "");

  const [kind, setKind] = useState<PeriodKind>("weekly");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [preview, setPreview] = useState<{ period: ResolvedPeriod; trades: number } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);

  const [consents, setConsents] = useState(initialConsents);
  const [pendingDisclosure, setPendingDisclosure] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [selectedId, setSelectedId] = useState(keys.find((k) => k.is_active)?.id ?? "");

  const usableKeys = keys.filter((k) => k.is_active);
  const selected = usableKeys.find((k) => k.id === selectedId) ?? usableKeys[0];
  const shown = reviews.find((r) => r.id === selectedReviewId) ?? reviews[0] ?? null;

  /**
   * Resolves the chosen period and counts what falls in it, server-side and
   * without touching a provider. Runs whenever the selection changes, so the
   * button can say exactly how much work -- and how much of the user's own
   * quota -- the next click costs.
   */
  // A custom range isn't askable until both ends are filled in. Checked here
  // rather than inside loadPreview so that function never writes state
  // synchronously -- doing so from an effect is what triggers the cascading
  // renders React warns about.
  const canPreview = kind !== "custom" || (startDate !== "" && endDate !== "");

  const loadPreview = useCallback(async () => {
    const params = new URLSearchParams({ kind });
    if (kind === "custom") {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }

    const res = await fetch(`/api/ai-reviews/period?${params}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setPreview(null);
      setPreviewError(body?.error ?? "Couldn't work out that period.");
      return;
    }
    setPreviewError(null);
    setPreview((await res.json()) as { period: ResolvedPeriod; trades: number });
  }, [kind, startDate, endDate]);

  // Fetching the count when the selection changes is what an effect is for,
  // and every state write inside loadPreview happens after its await -- but
  // the rule can't see through the async call, so it flags the call itself.
  // Same disable, for the same reason, as the mount guard in nav-bar.tsx.
  useEffect(() => {
    if (!canPreview) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPreview();
  }, [canPreview, loadPreview]);

  /**
   * Changing the period cancels any confirmation already on screen.
   *
   * Done here rather than in the effect above: a pending "analyse 47 trades?"
   * refers to the period that was selected when it appeared, and leaving it
   * standing while the selection moves underneath it would let a click
   * confirm a request the user never read.
   */
  function changeSelection(apply: () => void) {
    setConfirming(false);
    // The old count belongs to the old period. Clearing it means the button
    // can never offer to analyse a number of trades that no longer matches
    // what is selected.
    setPreview(null);
    setPreviewError(null);
    apply();
  }

  /**
   * `window` is supplied when regenerating: an existing review has to be
   * re-run over the period IT covered, not over whatever "weekly" resolves to
   * today. Left out when generating fresh, so weekly and monthly are resolved
   * server-side from the current date.
   */
  async function generate(window?: { kind: PeriodKind; startDate: string; endDate: string }) {
    if (!selected) return;
    setRunning(true);
    setError(null);
    setConfirming(false);
    setJustGenerated(false);

    const payload = window
      ? { keyId: selected.id, ...window }
      : {
          keyId: selected.id,
          kind,
          ...(kind === "custom" ? { startDate, endDate } : {}),
        };

    const res = await fetch("/api/ai-reviews/period", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setRunning(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        needsConsent?: AIProviderName;
      } | null;
      if (body?.needsConsent) {
        setPendingDisclosure(true);
        return;
      }
      setError(body?.error ?? "Couldn't generate a review.");
      return;
    }

    const body = (await res.json()) as { review: Review };
    setReviews((prev) => [body.review, ...prev]);
    setSelectedReviewId(body.review.id);
    // Freshly generated against the period as it stands right now.
    setStaleIds((prev) => {
      const next = new Set(prev);
      next.delete(body.review.id);
      return next;
    });
    // Regenerating replaces what is on screen with new prose, which on its own
    // is easy to miss. A brief confirmation is the only signal that the click
    // did anything.
    setJustGenerated(true);
    setTimeout(() => setJustGenerated(false), 3000);
    // The page was rendered before this review existed, so its cached payload
    // still doesn't list it. Without this the new review survives until the
    // next navigation that reuses that payload and then disappears.
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

  async function handleCopy(review: Review) {
    try {
      await navigator.clipboard.writeText(
        periodReviewToText(review.content, {
          label: `${review.period_start} to ${review.period_end}`,
          trades: review.trades_analyzed,
        }),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Your browser blocked clipboard access.");
    }
  }

  /** Re-runs a review over its own stored window. Produces a NEW review
   *  rather than overwriting -- period history is kept on purpose, so the old
   *  analysis stays available to compare against. */
  function handleRegenerate(review: Review) {
    if (!review.period_start || !review.period_end) return;
    void generate({
      kind: review.review_type === "trade" ? "custom" : review.review_type,
      startDate: review.period_start,
      endDate: review.period_end,
    });
  }

  async function handleDelete(review: Review) {
    if (!confirm("Delete this review? Your trades are not affected.")) return;

    const res = await fetch(`/api/ai-reviews/${review.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Couldn't delete that review.");
      return;
    }
    setReviews((prev) => prev.filter((r) => r.id !== review.id));
    if (selectedReviewId === review.id) setSelectedReviewId("");
    router.refresh();
  }

  if (usableKeys.length === 0) {
    return (
      <Card hoverable={false} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Connect an AI provider
        </h2>
        <p className="text-sm text-zinc-500">
          Reviews run on your own API key. Free options available. Add one on the{" "}
          <Link href="/ask" className="text-primary hover:underline">
            Ask page
          </Link>{" "}
          to use AI Reviews. Nothing is charged by this app.
        </p>
      </Card>
    );
  }

  const consented = selected ? consents.includes(selected.provider) : false;
  const canGenerate = preview !== null && preview.trades > 0 && !running;

  return (
    <div className="flex flex-col gap-4">
      {pendingDisclosure && selected && (
        <ProviderConsentCard
          provider={selected.provider}
          description="The trades in the period you picked go with the request: their prices, sizes,
            dates, strategies and your own notes and fields on them, together with the
            summary statistics for that period and the one before it."
          saving={savingConsent}
          onAccept={acceptDisclosure}
          onCancel={() => setPendingDisclosure(false)}
        />
      )}

      <Card hoverable={false} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(KIND_LABELS) as PeriodKind[]).map((k) => (
            <button
              key={k}
              onClick={() => changeSelection(() => setKind(k))}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                kind === k
                  ? "bg-primary text-white dark:text-zinc-950"
                  : "border border-zinc-300 text-zinc-600 hover:border-primary dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              {KIND_LABELS[k]}
            </button>
          ))}

          {kind === "custom" && (
            <>
              <input
                type="date"
                value={startDate}
                onChange={(e) => changeSelection(() => setStartDate(e.target.value))}
                className={inputClass}
                aria-label="Start date"
              />
              <span className="text-xs text-zinc-500">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => changeSelection(() => setEndDate(e.target.value))}
                className={inputClass}
                aria-label="End date"
              />
            </>
          )}
        </div>

        {/* What the next click actually costs, before it is spent. */}
        <p className="text-sm text-zinc-500">
          {previewError
            ? previewError
            : preview
              ? `${preview.period.label} — ${preview.trades} closed trade${
                  preview.trades === 1 ? "" : "s"
                }${preview.trades === 0 ? ". Nothing to review in this period." : "."}`
              : kind === "custom"
                ? "Pick a start and end date."
                : "Working out the period…"}
        </p>

        {confirming && preview ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              This review will analyse {preview.trades} trades from {preview.period.label}, using
              your own {selected && PROVIDER_LABELS[selected.provider]} key. Continue?
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => generate()}
                className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110"
              >
                Yes, analyse it
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-sm text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() =>
                preview && preview.trades > CONFIRM_ABOVE_TRADES ? setConfirming(true) : generate()
              }
              disabled={!canGenerate}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              {running
                ? "Analyzing..."
                : preview && preview.trades > 0
                  ? `Review ${preview.trades} trade${preview.trades === 1 ? "" : "s"}`
                  : "Generate review"}
            </button>

            {usableKeys.length > 1 && (
              <select
                value={selected?.id ?? ""}
                onChange={(e) => setSelectedId(e.target.value)}
                className={inputClass}
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
        )}

        <FormError className="rounded-lg border border-loss/40 px-3 py-2">{error}</FormError>
      </Card>

      {reviews.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            Previous
          </span>
          {reviews.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedReviewId(r.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                shown?.id === r.id
                  ? "border-primary text-primary"
                  : "border-zinc-300 text-zinc-500 hover:border-primary dark:border-zinc-700"
              }`}
            >
              {r.period_start} → {r.period_end}
              <span className="ml-1.5 text-zinc-400">({r.trades_analyzed})</span>
              {staleIds.has(r.id) && <span className="ml-1 text-amber-500">•</span>}
            </button>
          ))}
        </div>
      )}

      {shown ? (
        <Card hoverable={false}>
          <PeriodReviewCard
            review={shown}
            stale={staleIds.has(shown.id)}
            actions={
              <>
                {justGenerated && <span className="text-profit">Review ready</span>}
                <button
                  onClick={() => handleRegenerate(shown)}
                  disabled={running}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  {running ? "Analyzing..." : "Regenerate"}
                </button>
                <button
                  onClick={() => handleCopy(shown)}
                  className="hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <button onClick={() => handleDelete(shown)} className="text-loss hover:underline">
                  Delete
                </button>
              </>
            }
          />
        </Card>
      ) : (
        <Card hoverable={false}>
          <p className="text-sm text-zinc-500">
            No reviews yet. Pick a period above and generate one. It analyses your closed
            trades in that window and tells you what the data says you should work on.
          </p>
        </Card>
      )}
    </div>
  );
}
