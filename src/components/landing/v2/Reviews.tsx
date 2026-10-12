import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { FeaturedReview } from "@/lib/reviews/types";
import { shownName } from "@/lib/reviews/types";
import { Stars } from "@/components/reviews/StarInput";
import { SectionHeadline } from "./SectionHeadline";

// Real reviews only (docs/design-audit.md: "no testimonials until real ones
// exist"). Every card is a review a user wrote, allowed to be shown, and that
// Alon picked in Admin -> Reviews: 4-5 stars with a quote. No average, no
// count -- selected reviews can't stand for all of them, and the note says
// they are selected. With none picked yet, only the invitation shows.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

function LeaveReview() {
  return (
    <Link
      href="/review?from=homepage"
      data-track="review-cta"
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:border-primary/50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-200 dark:hover:text-zinc-50"
    >
      Using Trading Lens? Leave a review
      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
    </Link>
  );
}

export function Reviews({ reviews }: { reviews: FeaturedReview[] }) {
  if (reviews.length === 0) {
    return (
      <div className="flex justify-center px-6 pb-16 pt-2 sm:px-10">
        <LeaveReview />
      </div>
    );
  }

  return (
    <section aria-labelledby="reviews-heading" className="pb-16 pt-6">
      <div id="reviews-heading">
        <SectionHeadline kicker="Reviews">From people using Trading Lens</SectionHeadline>
      </div>
      <div className="mx-auto -mt-8 max-w-6xl px-6 sm:px-10">
        <p className="mb-6 text-center text-xs text-zinc-500">Selected reviews, shared with permission.</p>
        {/* Centred rows, so one or two picked reviews don't sit off to the left. */}
        <ul className="flex flex-wrap justify-center gap-4">
          {reviews.slice(0, 6).map((r, i) => (
            <li
              key={`${r.reviewedAt}-${i}`}
              className="flex w-full flex-col gap-3 rounded-2xl border border-zinc-200 bg-white/80 p-5 dark:border-subtle dark:bg-card/80 sm:w-[calc(50%-0.5rem)] lg:w-[calc((100%-2rem)/3)]"
            >
              <Stars rating={r.rating} />
              <blockquote className="line-clamp-6 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                &ldquo;{r.comment}&rdquo;
              </blockquote>
              <p className="mt-auto text-xs text-zinc-500">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{shownName(r.displayName)}</span>
                {month(r.reviewedAt) && <> &middot; {month(r.reviewedAt)}</>}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex justify-center">
          <LeaveReview />
        </div>
      </div>
    </section>
  );
}
