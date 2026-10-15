import Link from "next/link";
import type { Metadata } from "next";
import { BrandMark } from "@/components/brand-mark";
import { otpType } from "@/lib/auth/confirm-link";

export const metadata: Metadata = {
  title: "Confirm",
  // A page reached only from an emailed link; nothing to index.
  robots: { index: false, follow: false },
};

// Where every emailed auth link lands (the Supabase email templates point
// here with token_hash + type). Opening it uses nothing up: the one-time
// token is spent only when the button is pressed, by a POST to
// /auth/confirm/verify. Mail providers' link scanners open links before the
// person does, and used to spend the token on the way -- see that route.
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash, type: rawType, next } = await searchParams;
  const type = otpType(rawType);
  const recovery = type === "recovery";

  return (
    <div data-v2-page="auth" className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-start gap-3 rounded-xl border border-zinc-200 bg-white p-8 shadow-[0_1px_2px_rgba(28,27,24,0.05)] dark:border-subtle dark:bg-card">
        <BrandMark className="h-8 w-8" />
        {token_hash && type ? (
          <form method="post" action="/auth/confirm/verify" className="flex w-full flex-col items-start gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {recovery ? "Reset your password" : "One last step"}
            </h1>
            <p className="text-sm text-zinc-500">
              {recovery
                ? "Continue to choose a new password."
                : "Press the button to confirm your email and sign in."}
            </p>
            <input type="hidden" name="token_hash" value={token_hash} />
            <input type="hidden" name="type" value={type} />
            {next && <input type="hidden" name="next" value={next} />}
            <button
              type="submit"
              className="mt-1 w-full rounded-lg bg-primary px-5 py-2.5 font-medium text-white hover:brightness-110 dark:text-zinc-950"
            >
              {recovery ? "Continue" : "Confirm my email"}
            </button>
          </form>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              This link is incomplete
            </h1>
            <p className="text-sm text-zinc-500">
              Part of it may have been cut off. Open the link from the email again, or sign in.
            </p>
            <Link href="/sign-in" className="text-sm font-medium text-primary hover:underline">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
