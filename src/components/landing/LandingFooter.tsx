import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { SOCIAL_ICON_PATHS } from "@/components/landing/social-icons";

// The public site's footer, shared by /, /contact, /cookies, /paid-plan,
// /privacy and /terms. Phase 2C of docs/design-audit.md made it the full
// footer the audit asked for.
//
// Only links to pages that exist. The spec's "Compare" column arrives with
// the compare table (Phase 3D, still blocked on confirming competitor facts);
// "Import help" and "Changelog" are left out because there are no such
// pages. Alon chose real links only on 2026-09-27.
//
// Link text is zinc-500, not zinc-400: zinc-400 on the light background is
// about 2.6:1, under WCAG AA's 4.5:1. Legal links keep their full names, so
// each says what the document is without the surrounding context a
// screen-reader user listing links doesn't get.

const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/paid-plan", label: "Paid plan" },
      { href: "/#waitlist", label: "Join the waitlist" },
    ],
  },
  {
    heading: "Help",
    links: [
      { href: "/#faq", label: "FAQ" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms and Conditions" },
      { href: "/cookies", label: "Cookies Policy" },
    ],
  },
];

// The URLs from "Facts Alon supplies" in docs/design-audit.md.
const SOCIALS = [
  { href: "https://www.instagram.com/tradinglenz/", label: "Trading Lens on Instagram", icon: SOCIAL_ICON_PATHS.instagram },
  { href: "https://www.tiktok.com/@trading_lenz", label: "Trading Lens on TikTok", icon: SOCIAL_ICON_PATHS.tiktok },
  { href: "https://www.youtube.com/@TradingLenz", label: "Trading Lens on YouTube", icon: SOCIAL_ICON_PATHS.youtube },
];

const LINK = "text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

export function LandingFooter() {
  return (
    <footer className="border-t border-zinc-200 px-6 py-12 dark:border-subtle sm:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        {/* Two columns on a phone, brand block across the top: a single
            column made this footer 782px tall at 630px wide. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-[1.4fr_1fr_1fr_1fr] sm:gap-10">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
            >
              <BrandMark className="h-5 w-5" />
              Trading Lens
            </Link>
            <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
              A trading journal that checks every trade against your own rules. Free, no card.
            </p>
            <Link
              href="/sign-up"
              className="mt-1 w-fit text-sm font-medium text-primary hover:underline"
            >
              Start journaling free
            </Link>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading} className="flex flex-col gap-2.5">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">{column.heading}</p>
              {column.links.map((link) => (
                <Link key={link.href} href={link.href} className={`w-fit ${LINK}`}>
                  {link.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-zinc-100 pt-6 dark:border-subtle sm:flex-row">
          {/* The disclaimer sits with the copyright on every public page.
              Wording mirrors /terms ("Not financial advice"); a lawyer
              should confirm it (security hardening brief, Part B). */}
          <div className="flex flex-col items-center gap-1 text-center sm:items-start sm:text-left">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              © {new Date().getFullYear()} Trading Lens
            </span>
            <span className="max-w-md text-xs text-zinc-500 dark:text-zinc-400">
              A trading journal and education tool. Not financial advice.
            </span>
          </div>
          <div className="flex items-center gap-1">
            {SOCIALS.map((social) => (
              <a
                key={social.href}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
                  <path d={social.icon} />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
