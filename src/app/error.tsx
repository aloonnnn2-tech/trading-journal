"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

// Route-segment error boundary. Without this, any throw from a server
// component -- and ~49 query functions in src/lib end in `if (error) throw
// error` -- rendered Next's unstyled production fallback ("Application error:
// a server-side exception has occurred"), with no branding and no way back
// short of a manual reload.
//
// The common cause is a transient Supabase failure during render, which
// `reset()` genuinely recovers from: it re-renders the segment, re-running
// the query that failed.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side throws reach the browser as an opaque digest; log what we
    // do have so a report from a user is traceable to the server log line.
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-start gap-3 rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-8 shadow-[0_1px_2px_rgba(28,27,24,0.05)]">
        <BrandMark className="h-8 w-8" />
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Something went wrong
        </h1>
        <p className="text-sm text-zinc-500">
          This page couldn&apos;t load. That&apos;s usually temporary — trying again often works.
        </p>
        {error.digest && (
          <p className="font-mono text-[11px] text-zinc-400">Reference: {error.digest}</p>
        )}
        <div className="mt-1 flex items-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110"
          >
            Try again
          </button>
          <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
