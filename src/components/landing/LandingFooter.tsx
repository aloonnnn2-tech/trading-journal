import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export function LandingFooter() {
  return (
    <footer className="border-t border-zinc-200 dark:border-subtle px-6 py-10 sm:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            <BrandMark className="h-5 w-5" />
            Trading Journal
          </Link>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-zinc-500">
            <Link href="/#features" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Features
            </Link>
            <Link href="/#pricing" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Pricing
            </Link>
            <Link href="/sign-in" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Log in
            </Link>
            <Link href="/sign-up" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Sign up
            </Link>
          </div>
        </div>
        <div className="flex flex-col items-center justify-between gap-3 border-t border-zinc-100 pt-6 text-xs text-zinc-400 dark:border-subtle sm:flex-row">
          <span>© 2026 Trading Journal</span>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Terms
            </Link>
            <Link href="/contact" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Contact
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
