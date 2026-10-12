"use client";

import { useId, useState } from "react";
import { MAX_COMMENT, MAX_DISPLAY_NAME, type MyReview, type ReviewSource } from "@/lib/reviews/types";
import { StarInput } from "./StarInput";

// The one review form: in the dialog the corner card opens, and on /review.
// Nothing is public unless the writer ticks the box -- and even then it is
// shown only if Alon picks it (Admin -> Reviews).
export function ReviewForm({
  initial,
  initialRating = 0,
  source,
  onSaved,
  onRemoved,
}: {
  initial: MyReview | null;
  initialRating?: number;
  source: ReviewSource;
  onSaved?: (review: MyReview) => void;
  onRemoved?: () => void;
}) {
  const id = useId();
  const [rating, setRating] = useState(initial?.rating ?? initialRating);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [allowPublic, setAllowPublic] = useState(initial?.allowPublic ?? false);
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "removed">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!rating) {
      setError("Choose 1 to 5 stars first.");
      return;
    }
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/reviews/mine", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment, allowPublic, displayName, source }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't save your review. Try again.");
      setState("saved");
      onSaved?.(body.review as MyReview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your review. Try again.");
      setState("idle");
    }
  }

  async function remove() {
    setState("saving");
    setError(null);
    const res = await fetch("/api/reviews/mine", { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setError("Couldn't remove it. Try again.");
      setState("idle");
      return;
    }
    setState("removed");
    onRemoved?.();
  }

  if (state === "saved" || state === "removed") {
    return (
      <div role="status" className="py-4 text-center">
        <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {state === "saved" ? "Thank you!" : "Your review is removed."}
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {state === "saved"
            ? "It helps decide what to improve next."
            : "You can write a new one any time from the account menu."}
        </p>
      </div>
    );
  }

  const low = rating > 0 && rating <= 3;
  const busy = state === "saving";

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <StarInput value={rating} onChange={setRating} size="lg" />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-comment`} className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {low ? "What would make it better?" : "Anything you'd like to add?"}{" "}
          <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <textarea
          id={`${id}-comment`}
          value={comment}
          maxLength={MAX_COMMENT}
          rows={4}
          onChange={(e) => setComment(e.target.value)}
          placeholder={low ? "What got in your way, or what's missing?" : "What do you use it for? What do you like?"}
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <span className="self-end text-[11px] text-zinc-500">
          {comment.length}/{MAX_COMMENT}
        </span>
      </div>

      <label className="flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={allowPublic}
          onChange={(e) => setAllowPublic(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span>
          You may show this review on the Trading Lens homepage.
          <span className="block text-xs text-zinc-500">Never your email. Only reviews picked by the team are shown.</span>
        </span>
      </label>

      {allowPublic && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Name to show <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id={`${id}-name`}
            value={displayName}
            maxLength={MAX_DISPLAY_NAME}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Dan K. (blank shows “Trading Lens user”)"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !rating}
          data-track="review-submit"
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 dark:text-zinc-950"
        >
          {busy ? "Saving…" : initial ? "Update my review" : "Send review"}
        </button>
        {initial && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            data-track="review-remove"
            className="text-sm text-zinc-500 hover:text-loss hover:underline disabled:opacity-50"
          >
            Remove my review
          </button>
        )}
      </div>
    </form>
  );
}
