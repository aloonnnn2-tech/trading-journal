import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/supabase/auth";
import { deletionProof, PROOF_MESSAGES } from "@/lib/account/deletion-proof";
import { BrandMark } from "@/components/brand-mark";
import { ConfirmDeleteButton } from "./confirm-delete-button";

const LINK_FAILED =
  "That link didn't work. It may have been used already, expired, or been opened in a different browser from the one where you asked. Ask for a new link from the Account page, and open it in that same browser.";

export const metadata: Metadata = {
  title: "Delete your account",
  robots: { index: false, follow: false },
};

// Where the emailed deletion link ends up (2026-10-20): /auth/confirm signs
// the person in from the link, then sends them here. The same check as the
// delete route decides what this page offers -- the button only appears for
// a sign-in from that link, and the route checks again when it's pressed.
export default async function ConfirmDeletePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string; link?: string }>;
}) {
  const { code, error, link } = await searchParams;
  // Supabase's default email: its link comes back here with a one-time code,
  // which /auth/callback turns into a session (in the browser that asked for
  // the deletion) and sends back here without it.
  if (code) {
    redirect(`/auth/callback?${new URLSearchParams({ code, next: "/account/delete/confirm" })}`);
  }
  const linkFailed = Boolean(error) || link === "failed";

  const userId = await requireUserId();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? "";

  let proof;
  try {
    proof = await deletionProof(supabase, createAdminClient(), userId);
  } catch {
    proof = { ok: false as const, reason: "unavailable" as const };
  }
  // A link that was already used, has expired, or was opened in a different
  // browser from the one that asked: say so, rather than the general message.
  const failedMessage = linkFailed && !proof.ok ? LINK_FAILED : null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col items-start gap-4 rounded-xl border border-loss/30 bg-white p-8 dark:bg-card">
        <BrandMark className="h-8 w-8" />
        {proof.ok ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Delete your account?</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              This permanently deletes <span className="font-semibold text-zinc-900 dark:text-zinc-100">{email}</span>{" "}
              and everything in it: your trades, screenshots, notes, strategies, settings and AI reviews. It can&apos;t
              be undone.
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Want a copy first?{" "}
              <a href="/api/account/export" download className="font-medium text-primary hover:underline">
                Download all your data
              </a>
              .
            </p>
            <div className="flex w-full flex-col gap-2">
              <ConfirmDeleteButton />
              <Link
                href="/dashboard"
                className="rounded-lg px-4 py-2 text-center text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Keep my account
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Your account wasn&apos;t deleted
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{failedMessage ?? PROOF_MESSAGES[proof.reason]}</p>
            <Link href="/account" className="text-sm font-medium text-primary hover:underline">
              Go to Account
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
