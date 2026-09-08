"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sun, Moon, HelpCircle, UserCircle, ShieldCheck, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/brand-mark";
import { PUBLIC_PATHS } from "@/lib/public-paths";
import { startTour } from "@/components/tour/tour-overlay";

// Twelve flat links became six top-level items.
//
// The old list was every page in the app, side by side, in the order they
// happened to be built -- so Goals, Reports and AI Reviews arrived as equal
// peers to Commissions, and a new user met twelve choices before doing
// anything. These three stay direct because they are the daily path; the rest
// group by the question they answer.

interface NavLink {
  href: string;
  label: string;
  /** Shown under the label in a dropdown, so a group is browsable without
   *  having to already know what each page is. */
  hint?: string;
}

const PRIMARY_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trades", label: "Trades" },
  { href: "/strategies", label: "Strategies" },
];

const NAV_GROUPS: { label: string; links: NavLink[] }[] = [
  {
    label: "Analysis",
    links: [
      { href: "/analytics", label: "Analytics", hint: "Equity, drawdown, risk, market conditions" },
      { href: "/insights", label: "Insights", hint: "Patterns and recurring mistakes" },
      { href: "/goals", label: "Goals", hint: "Commitments scored from your trades" },
      { href: "/reports", label: "Reports", hint: "A printable weekly or monthly summary" },
      { href: "/emotions", label: "Emotions", hint: "How your mood tracks your results" },
    ],
  },
  {
    label: "AI",
    links: [
      { href: "/ask", label: "Ask", hint: "Questions about your own journal" },
      { href: "/reviews", label: "AI Reviews", hint: "Your week or month, critiqued" },
    ],
  },
  {
    label: "Setup",
    links: [
      { href: "/fields", label: "Fields", hint: "Track anything the app doesn't already" },
      { href: "/commissions", label: "Commissions", hint: "Broker fees, so P/L is always net" },
    ],
  },
];

/** A link is active on its own page and on anything nested under it. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

function NavItem({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      data-tour-id={`nav-${link.href.slice(1)}`}
      className={`relative shrink-0 px-3 py-3.5 text-[13px] transition-colors ${
        active
          ? "font-medium text-zinc-900 dark:text-zinc-50"
          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {link.label}
      {active && (
        <motion.span
          layoutId="nav-underline"
          className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary"
        />
      )}
    </Link>
  );
}

export function NavBar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Standard next-themes hydration guard: resolvedTheme is unknown on the
  // server, so the theme icon only renders once mounted on the client.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // Dismissing an open group menu. Both listeners are attached only while a
  // menu is actually open, so the app is not holding document-level handlers
  // for the 99% of the time nothing is expanded.
  useEffect(() => {
    if (openGroup === null && !helpOpen) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      // `closest` rather than a ref: the menu and its button are siblings
      // inside the same relative wrapper, so one check covers both and a
      // click on the button still toggles rather than double-firing.
      if (target?.closest("[data-nav-group]")) return;
      setOpenGroup(null);
      setHelpOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenGroup(null);
        setHelpOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openGroup, helpOpen]);

  useEffect(() => {
    if (PUBLIC_PATHS.includes(pathname)) return;
    if (localStorage.getItem("tz-synced") === "1") return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch("/api/settings/timezone", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    })
      .then((res) => {
        if (res.ok) localStorage.setItem("tz-synced", "1");
      })
      .catch(() => {
        // Best-effort — day-of-week insights just fall back to UTC until this succeeds.
      });
  }, [pathname]);

  if (PUBLIC_PATHS.includes(pathname)) {
    return null;
  }

  async function handleSignOut() {
    const supabase = createClient();
    try {
      await supabase.auth.signOut();
    } catch {
      // Still navigate away even if the network call failed -- better
      // than leaving the user stuck on the current page looking
      // logged-in with no way to tell sign-out didn't complete.
    }
    // A real navigation, not router.push+refresh() -- that combo is the
    // same racy client-router pattern that caused the sign-in blank-screen
    // bug (see sign-in/page.tsx): the two calls can abort each other and
    // leave the transition stuck, which is why sign-out sometimes needed a
    // second click to actually take effect.
    window.location.href = "/";
  }

  return (
    // print:hidden so a printed report is the document alone -- the nav is
    // chrome, and it appears on every page, so hiding it here covers all of
    // them rather than only /reports.
    <header className="sticky top-0 z-40 border-b border-zinc-200 dark:border-subtle bg-white/85 dark:bg-background/85 backdrop-blur-md print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 sm:flex-nowrap sm:px-8">
        <Link
          href="/dashboard"
          className="order-1 flex shrink-0 items-center gap-2.5 py-3.5 font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          <BrandMark className="h-6 w-6" />
          <span className="hidden sm:inline">Trading Lens</span>
        </Link>
        {/* Below `sm`, this wraps onto its own full-width row instead of the
            horizontal-scroll-with-no-affordance it used to be -- every other
            multi-item row in this app (status/folder/strategy tabs on
            /trades) already wraps the same way, this just brings the primary
            nav in line with that pattern. */}
        <nav className="order-3 flex w-full flex-wrap items-center gap-1 sm:order-2 sm:w-auto sm:min-w-0 sm:flex-nowrap">
          {PRIMARY_LINKS.map((link) => (
            <NavItem key={link.href} link={link} active={isActive(pathname, link.href)} />
          ))}

          {NAV_GROUPS.map((group) => {
            const activeChild = group.links.find((l) => isActive(pathname, l.href));
            const open = openGroup === group.label;
            return (
              <div key={group.label} data-nav-group className="relative shrink-0">
                <button
                  type="button"
                  // Click, not hover: a hover menu opens itself when the
                  // pointer merely crosses the bar on its way somewhere else,
                  // and is unreachable by touch.
                  onClick={() => setOpenGroup(open ? null : group.label)}
                  aria-expanded={open}
                  aria-haspopup="true"
                  className={`relative flex items-center gap-1 px-3 py-3.5 text-[13px] transition-colors ${
                    activeChild
                      ? "font-medium text-zinc-900 dark:text-zinc-50"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  {group.label}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
                    strokeWidth={2}
                  />
                  {/* The underline follows the group when one of its pages is
                      open, so the bar still says where you are even though the
                      page itself is now one level down. */}
                  {activeChild && (
                    <motion.span
                      layoutId="nav-underline"
                      className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary"
                    />
                  )}
                </button>

                {open && (
                  <div className="absolute left-0 top-full z-50 mt-0.5 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-subtle dark:bg-card">
                    {group.links.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        data-tour-id={`nav-${link.href.slice(1)}`}
                        // Closed here rather than in an effect watching the
                        // pathname: clicking a link to the page you are
                        // already on produces no navigation, so an effect
                        // would leave the menu stuck open.
                        onClick={() => setOpenGroup(null)}
                        className={`block px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                          isActive(pathname, link.href)
                            ? "text-zinc-900 dark:text-zinc-50"
                            : "text-zinc-600 dark:text-zinc-400"
                        }`}
                      >
                        <span className="block text-[13px] font-medium">{link.label}</span>
                        {link.hint && (
                          <span className="block text-[11px] text-zinc-500">{link.hint}</span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="order-2 flex shrink-0 items-center gap-1 sm:order-3">
          {/* Only rendered for an admin, so its presence is itself the
              "you have admin rights" signal, and it's the only way into
              /admin/analytics short of typing the URL. */}
          {isAdmin && (
            <Link
              href="/admin/analytics"
              title="Admin analytics"
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] ${
                pathname.startsWith("/admin")
                  ? "bg-primary/10 text-primary"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          )}
          {/* Two tours, not one. The signup walkthrough covers logging a
              trade; the feature tour covers everything the app grew after
              that, and is only worth taking once there are trades to look at.
              Hiding the second one behind the same icon is what stopped a new
              user ever discovering Goals, Reports or AI Reviews existed. */}
          <div data-nav-group className="relative">
            <button
              onClick={() => setHelpOpen((open) => !open)}
              title="Guided tours"
              aria-expanded={helpOpen}
              aria-haspopup="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            {helpOpen && (
              <div className="absolute right-0 top-full z-50 mt-0.5 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-subtle dark:bg-card">
                <button
                  onClick={() => {
                    setHelpOpen(false);
                    startTour("basics");
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                    Getting started
                  </span>
                  <span className="block text-[11px] text-zinc-500">
                    Log a trade and find your way around. About a minute
                  </span>
                </button>
                <button
                  onClick={() => {
                    setHelpOpen(false);
                    startTour("features");
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                    The full toolkit
                  </span>
                  <span className="block text-[11px] text-zinc-500">
                    Rules, mistakes, edges, goals, reports and AI reviews. Best once you have
                    closed a few trades
                  </span>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            title="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            {mounted && (resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />)}
          </button>
          <Link
            href="/account"
            title="Account"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <UserCircle className="h-4 w-4" />
          </Link>
          <button
            onClick={handleSignOut}
            className="rounded-lg px-3 py-1.5 text-[13px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
