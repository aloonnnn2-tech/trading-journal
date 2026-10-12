"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/dates/format";
import { useMounted } from "@/lib/use-mounted";
import type { AdminReview } from "@/lib/reviews/queries";
import { canFeature, shownName, SOURCE_LABELS, type ReviewSource } from "@/lib/reviews/types";
import { Stars } from "@/components/reviews/StarInput";

// Every review, newest first, filterable by stars. "Show on homepage" is
// only offered where it is allowed (public, 4-5 stars, a comment); the
// database refuses the rest anyway.
export function ReviewsTable({ initialReviews }: { initialReviews: AdminReview[] }) {
  const [reviews, setReviews] = useState(initialReviews);
  const [stars, setStars] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Dates render after mount: the server's timezone is not the admin's.
  const mounted = useMounted();

  async function toggle(review: AdminReview) {
    setBusy(review.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured: !review.featured }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't update that review.");
      setReviews((all) => all.map((r) => (r.id === review.id ? { ...r, featured: !review.featured } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update that review.");
    } finally {
      setBusy(null);
    }
  }

  const shown = stars ? reviews.filter((r) => r.rating === stars) : reviews;
  const chip = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs ${
      active
        ? "border-primary bg-primary/10 text-zinc-900 dark:text-zinc-50"
        : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
    }`;

  if (reviews.length === 0) {
    return <p className="text-sm text-zinc-500">No reviews yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Filter by stars" className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={stars === null} onClick={() => setStars(null)} className={chip(stars === null)}>
          All
        </button>
        {[5, 4, 3, 2, 1].map((n) => (
          <button key={n} type="button" aria-pressed={stars === n} onClick={() => setStars(n)} className={chip(stars === n)}>
            {n}★
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {shown.map((r) => {
          const allowed = canFeature(r);
          return (
            <li
              key={r.id}
              className={`rounded-xl border p-4 ${r.featured ? "border-primary/50 bg-primary/[0.04]" : "border-zinc-200 dark:border-subtle"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Stars rating={r.rating} />
                  <span className="text-xs text-zinc-500">{r.email ?? "(account deleted)"}</span>
                  <span className="text-xs text-zinc-400">
                    {SOURCE_LABELS[r.source as ReviewSource] ?? r.source}
                  </span>
                </div>
                <span className="text-xs text-zinc-400">
                  {mounted ? formatDateTime(r.updatedAt) : ""}
                  {r.updatedAt !== r.createdAt && " (edited)"}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
                {r.comment ?? <span className="italic text-zinc-400">No comment</span>}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-xs dark:border-subtle">
                <span className="text-zinc-500">
                  {r.allowPublic ? (
                    <>May be shown as <strong className="text-zinc-700 dark:text-zinc-300">{shownName(r.displayName)}</strong></>
                  ) : (
                    "Private: the writer didn't allow public display"
                  )}
                </span>
                <button
                  type="button"
                  disabled={!allowed || busy === r.id}
                  aria-pressed={r.featured}
                  onClick={() => void toggle(r)}
                  title={allowed ? undefined : "Only 4–5 star reviews with a comment, whose writer allowed it"}
                  className={`rounded-lg border px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                    r.featured
                      ? "border-primary bg-primary text-white dark:text-zinc-950"
                      : "border-zinc-300 text-zinc-700 hover:border-primary/60 dark:border-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {r.featured ? "On homepage ✓" : "Show on homepage"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="text-sm text-zinc-500">No {stars}-star reviews.</p>}
    </div>
  );
}
