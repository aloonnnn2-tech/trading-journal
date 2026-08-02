import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

// Renders for notFound() -- currently thrown by the trade detail page for an
// id that doesn't exist or belongs to another user (RLS filters it out, so
// both cases land here identically) -- and for any unmatched URL. Without
// this file both fell through to Next's stock 404, outside the app's design.
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-start gap-3 rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-8 shadow-[0_1px_2px_rgba(28,27,24,0.05)]">
        <BrandMark className="h-8 w-8" />
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Not found
        </h1>
        <p className="text-sm text-zinc-500">
          This page doesn&apos;t exist, or the trade was deleted.
        </p>
        <div className="mt-1 flex items-center gap-3">
          <Link
            href="/trades"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110"
          >
            View trades
          </Link>
          <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
