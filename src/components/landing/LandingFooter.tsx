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
            Trading Lens
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
        {/* zinc-500, not zinc-400. zinc-400 on this near-white background is
            about 2.6:1, under the 4.5:1 WCAG AA minimum -- and these are the
            legal links, which are exactly the ones that must not be hard to
            read. Dark mode is unaffected: the dark: override was already
            zinc-400-on-near-black, which passes comfortably.

            Full names rather than "Privacy"/"Terms" so the link text says what
            the document is, on its own, without the surrounding context a
            screen-reader user listing links does not get. `flex-wrap` keeps
            all four on a phone instead of pushing one off the edge. */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-zinc-100 pt-6 text-xs text-zinc-500 dark:border-subtle dark:text-zinc-400 sm:flex-row">
          <span>© 2026 Trading Lens</span>
          <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Terms and Conditions
            </Link>
            <Link href="/cookies" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Cookies Policy
            </Link>
            <Link href="/contact" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Contact
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
