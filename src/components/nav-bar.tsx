"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useAccountThemeToggle } from "@/components/preferences/preferences-provider";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sun, Moon, HelpCircle, UserCircle, ShieldCheck, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { endSession } from "@/lib/tracking/useAnalytics";
import { BrandMark } from "@/components/brand-mark";
import { PUBLIC_PATHS } from "@/lib/public-paths";
import { startTour } from "@/components/tour/tour-overlay";
import { NAV_GROUPS, PRIMARY_LINKS, navGroupTourId, navLinkTourId, type NavLink } from "@/lib/nav/links";

// The menu's links live in src/lib/nav/links.ts, shared with the guided tour.

/** The guided tours, shared by the help menu (>=1000px) and the account menu
 *  (below it), so the two cannot drift apart. */
function TourButtons({ isPaid, onPick }: { isPaid: boolean; onPick: () => void }) {
  return (
    <>
      <button
        onClick={() => {
          onPick();
          startTour("basics");
        }}
        className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
          Getting started
        </span>
        <span className="block text-[11px] text-zinc-500">
          Log a trade and meet the core of the app. Nine steps, about two minutes
        </span>
      </button>
      <button
        onClick={() => {
          onPick();
          startTour("features");
        }}
        className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
          The full toolkit
        </span>
        <span className="block text-[11px] text-zinc-500">
          The free features the core tour walked past: import, export, cash, goals, emotions,
          fields, fees. Seven steps
        </span>
      </button>
      {isPaid && (
        <button
          onClick={() => {
            onPick();
            startTour("paid");
          }}
          className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
            Paid features
          </span>
          <span className="block text-[11px] text-zinc-500">
            Only what the paid plan unlocks. Ten steps
          </span>
        </button>
      )}
    </>
  );
}

/** A link is active on its own page and on anything nested under it. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

function NavItem({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      data-tour-id={navLinkTourId(link.href)}
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

export function NavBar({ isAdmin = false, isPaid = false }: { isAdmin?: boolean; isPaid?: boolean }) {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  // Saves to the account too, so every browser signed in matches.
  const toggleTheme = useAccountThemeToggle();
  const [accountOpen, setAccountOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Standard next-themes hydration guard: resolvedTheme is unknown on the
  // server, so the theme icon only renders once mounted on the client.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // Dismissing an open group menu. Both listeners are attached only while a
  // menu is actually open, so the app is not holding document-level handlers
  // for the 99% of the time nothing is expanded.
  useEffect(() => {
    if (openGroup === null && !helpOpen && !accountOpen) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      // `closest` rather than a ref: the menu and its button are siblings
      // inside the same relative wrapper, so one check covers both and a
      // click on the button still toggles rather than double-firing.
      if (target?.closest("[data-nav-group]")) return;
      setOpenGroup(null);
      setHelpOpen(false);
      setAccountOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenGroup(null);
        setHelpOpen(false);
        setAccountOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openGroup, helpOpen, accountOpen]);

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
    // Before anything else: the analytics session belongs to the account that
    // is signing out, and sessionStorage would otherwise carry its id into
    // whoever signs in next in this tab.
    endSession();
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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 sm:flex-nowrap sm:px-8">
        <Link
          href="/dashboard"
          className="order-1 flex shrink-0 items-center gap-2.5 py-3.5 font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          <BrandMark className="h-6 w-6" />
          <span className="hidden sm:inline">Trading Lens</span>
        </Link>
        {/* Below `sm` (phones) these links live in the bottom tab bar and
            its More sheet (components/mobile/mobile-tab-bar.tsx) instead: here
            they wrapped onto two rows and took ~155px off every screen. */}
        <nav className="order-3 hidden w-full items-center gap-1 sm:order-2 sm:flex sm:w-auto sm:min-w-0 sm:flex-nowrap">
          {PRIMARY_LINKS.map((link) => (
            <NavItem key={link.href} link={link} active={isActive(pathname, link.href)} />
          ))}

          {NAV_GROUPS.map((group) => {
            const activeChild = group.links.find((l) => isActive(pathname, l.href));
            const open = openGroup === group.label;
            return (
              <div
                key={group.label}
                data-nav-group
                // Setup folds into the account menu below 1000px: it is the
                // least-used of the three groups and the one that collided.
                className={`relative shrink-0 ${group.label === "Setup" ? "hidden nav:block" : ""}`}
              >
                <button
                  type="button"
                  // Click, not hover: a hover menu opens itself when the
                  // pointer merely crosses the bar on its way somewhere else,
                  // and is unreachable by touch.
                  onClick={() => setOpenGroup(open ? null : group.label)}
                  // The tour points here when its next stop is inside this
                  // menu (src/lib/tour/nav-target.ts).
                  data-tour-id={navGroupTourId(group.label)}
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
                        data-tour-id={navLinkTourId(link.href)}
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
          <div data-nav-group className="relative hidden nav:block">
            <button
              onClick={() => setHelpOpen((open) => !open)}
              title="Guided tours"
              data-tour-id="nav-help"
              aria-expanded={helpOpen}
              aria-haspopup="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            {helpOpen && (
              <div className="absolute right-0 top-full z-50 mt-0.5 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-subtle dark:bg-card">
                <TourButtons isPaid={isPaid} onPick={() => setHelpOpen(false)} />
              </div>
            )}
          </div>
          <button
            onClick={() => void toggleTheme()}
            title="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            {mounted && (resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />)}
          </button>
          {/* The account icon was a bare link to /account. It is a menu now,
              because below 1000px it is where Setup, the guided tours and
              Sign out go -- the bar could not hold eleven items and was
              running "Setup" through the help icon at 850px (issue 1 of
              docs/design-audit.md). Above 1000px the menu holds only account
              settings and sign-out, and everything else stays in the bar. */}
          <div data-nav-group className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((open) => !open)}
              title="Account"
              aria-label="Account menu"
              // The basics tour ends on "replay this any time from here",
              // pointed at nav-help. Below 1000px the help button is hidden
              // and the tours live in this menu, so this button is "here".
              // It comes after the help button in the markup, and the tour
              // takes the first *visible* match (findTarget in
              // tour-overlay.tsx), so above 1000px the help button still wins.
              data-tour-id="nav-help"
              aria-expanded={accountOpen}
              aria-haspopup="true"
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                isActive(pathname, "/account")
                  ? "bg-primary/10 text-primary"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              <UserCircle className="h-4 w-4" />
            </button>
            {accountOpen && (
              <div className="absolute right-0 top-full z-50 mt-0.5 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-subtle dark:bg-card">
                <Link
                  href="/account"
                  onClick={() => setAccountOpen(false)}
                  className="block px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                    Account
                  </span>
                  <span className="block text-[11px] text-zinc-500">
                    Plan, AI keys, data export, deletion
                  </span>
                </Link>

                {/* Only below the nav breakpoint, where these are not in the
                    bar. Hidden with CSS rather than a width check in JS so
                    the server and the client render the same markup. */}
                <div className="nav:hidden">
                  <div className="my-1 border-t border-zinc-200 dark:border-subtle" />
                  {NAV_GROUPS.filter((g) => g.label === "Setup").flatMap((g) => g.links).map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      data-tour-id={navLinkTourId(link.href)}
                      onClick={() => setAccountOpen(false)}
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

                  <div className="my-1 border-t border-zinc-200 dark:border-subtle" />
                  <p
                    className="px-3 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500"
                  >
                    Guided tours
                  </p>
                  <TourButtons isPaid={isPaid} onPick={() => setAccountOpen(false)} />
                </div>

                <div className="my-1 border-t border-zinc-200 dark:border-subtle" />
                <button
                  onClick={handleSignOut}
                  className="block w-full px-3 py-2 text-left text-[13px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
          {/* Kept in the bar at full width, where there is room for a
              one-click sign-out. Below the breakpoint it lives in the menu
              above. */}
          <button
            onClick={handleSignOut}
            className="hidden rounded-lg px-3 py-1.5 text-[13px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 nav:block dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
