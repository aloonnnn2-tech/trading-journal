import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { recordAudit } from "@/lib/admin/audit";
import { isAdmin } from "@/lib/tracking/admin-queries";
import { isMissingReviews, listAllReviews, type AdminReview } from "@/lib/reviews/queries";
import { Card } from "@/components/ui/Card";
import { Stars } from "@/components/reviews/StarInput";
import { AdminTabs } from "../admin-tabs";
import { ReviewsTable } from "./reviews-table";

export const metadata: Metadata = {
  title: "Reviews — Admin",
  robots: { index: false },
};

export default async function AdminReviewsPage() {
  const userId = await requireUserId();
  const supabase = await createClient();
  // isAdmin() fails closed; the database function checks is_admin again.
  if (!(await isAdmin(supabase, userId))) redirect("/dashboard");
  await recordAudit({ actorId: userId, action: "admin_page_view", target: "/admin/reviews" });

  let reviews: AdminReview[] = [];
  let missing = false;
  try {
    reviews = await listAllReviews(supabase);
  } catch (error) {
    if (isMissingReviews(error)) missing = true;
    else throw error;
  }

  const total = reviews.length;
  const average = total ? reviews.reduce((s, r) => s + r.rating, 0) / total : 0;
  const counts = [5, 4, 3, 2, 1].map((n) => ({ n, count: reviews.filter((r) => r.rating === n).length }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <AdminTabs active="reviews" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Reviews</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          What users think of Trading Lens. Only reviews you switch on appear on the homepage, and only
          4–5 star reviews with a comment whose writer allowed it. The numbers here are for you; the
          homepage shows no average or count.
        </p>
      </div>

      {missing ? (
        <Card className="text-sm text-zinc-500" hoverable={false}>
          Reviews aren&apos;t set up yet. Apply <code>supabase/migrations/0064_app_reviews.sql</code> in the
          Supabase SQL editor.
        </Card>
      ) : (
        <>
          <Card hoverable={false} className="flex flex-wrap items-center gap-x-10 gap-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Reviews</p>
              <p className="tnum font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{total}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Average</p>
              <p className="tnum flex items-center gap-2 font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {total ? average.toFixed(1) : "—"}
                {total > 0 && <Stars rating={Math.round(average)} />}
              </p>
            </div>
            <ul className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
              {counts.map(({ n, count }) => (
                <li key={n} className="flex items-center gap-2">
                  <span className="w-6 tnum font-mono">{n}★</span>
                  <span className="h-2 w-40 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <span
                      className="block h-full rounded-full bg-amber-400"
                      style={{ width: total ? `${(count / total) * 100}%` : "0%" }}
                    />
                  </span>
                  <span className="tnum font-mono">{count}</span>
                </li>
              ))}
            </ul>
          </Card>
          <ReviewsTable initialReviews={reviews} />
        </>
      )}
    </div>
  );
}
