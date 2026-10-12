import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { getMyReview } from "@/lib/reviews/queries";
import { Card } from "@/components/ui/Card";
import { ReviewForm } from "@/components/reviews/ReviewForm";

// Rate Trading Lens: reached from the homepage's "Leave a review" button and
// the account menu. Signed out, sign-in brings you back here (next=/review,
// an allowlisted path -- src/lib/auth/next-path.ts).

export const metadata: Metadata = {
  title: "Rate Trading Lens",
  robots: { index: false },
};

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const userId = await getUserIdFromHeader();
  if (!userId) redirect("/sign-in?next=/review");
  const { from } = await searchParams;
  const review = await getMyReview(await createClient(), userId);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Rate Trading Lens</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          {review
            ? "Here is your review. Change anything, or remove it."
            : "1 to 5 stars, and a comment if you like. It helps decide what to improve next."}
        </p>
      </div>
      <Card hoverable={false}>
        <ReviewForm initial={review} source={from === "homepage" ? "homepage" : "account_menu"} />
      </Card>
    </div>
  );
}
