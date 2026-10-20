import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { deletionProof, isDeletionTokenShape, PROOF_MESSAGES, type DeletionProof } from "@/lib/account/deletion-proof";
import { BrandMark } from "@/components/brand-mark";
import { ConfirmDeleteButton } from "./confirm-delete-button";

export const metadata: Metadata = {
  title: "Delete your account",
  robots: { index: false, follow: false },
};

// Where the emailed deletion link lands (2026-10-20): /account/delete/
// confirm/<code>, from Supabase's email (which may also add a ?code= of its
// own; ignored). Opening it deletes nothing: the button does, and the delete
// route checks the code again. Works in any browser -- the code is the proof
// of the inbox; being signed in as the account is the proof of whose it is.
export default async function ConfirmDeletePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const userId = await getUserIdFromHeader();

  if (!userId) {
    // Not signed in in this browser (the email opened elsewhere): sign in
    // and come straight back here, code and all.
    const next = isDeletionTokenShape(token) ? `/account/delete/confirm/${token}` : null;
    return (
      <Shell>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Sign in to continue</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          To finish deleting your account, sign in to it in this browser. You&apos;ll come back to this page, and
          nothing is deleted until you press the button here.
        </p>
        <Link
          href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:brightness-110 dark:text-zinc-950"
        >
          Sign in
        </Link>
      </Shell>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? "";

  let proof: DeletionProof;
  try {
    proof = await deletionProof(createAdminClient(), userId, token);
  } catch {
    proof = { ok: false, reason: "unavailable" };
  }

  return (
    <Shell>
      {proof.ok ? (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Delete your account?</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This permanently deletes <span className="font-semibold text-zinc-900 dark:text-zinc-100">{email}</span> and
            everything in it: your trades, screenshots, notes, strategies, settings and AI reviews. It can&apos;t be
            undone.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Want a copy first?{" "}
            <a href="/api/account/export" download className="font-medium text-primary hover:underline">
              Download all your data
            </a>
            .
          </p>
          <div className="flex w-full flex-col gap-2">
            <ConfirmDeleteButton token={token} />
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
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{PROOF_MESSAGES[proof.reason]}</p>
          <Link href="/account" className="text-sm font-medium text-primary hover:underline">
            Go to Account
          </Link>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col items-start gap-4 rounded-xl border border-loss/30 bg-white p-8 dark:bg-card">
        <BrandMark className="h-8 w-8" />
        {children}
      </div>
    </div>
  );
}
