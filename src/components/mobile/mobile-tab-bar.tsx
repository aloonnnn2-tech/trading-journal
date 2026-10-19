"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3, Download, FileUp, LayoutDashboard, List, Menu, Moon, Plus, Sun, UserCircle, X } from "lucide-react";
import { useTheme } from "next-themes";
import { PUBLIC_PATHS } from "@/lib/public-paths";
import { NAV_GROUPS, PRIMARY_LINKS, navLinkTourId } from "@/lib/nav/links";
import { AddTradeButton, QuickTradeButton } from "@/app/trades/new-trade-button";
import { ScreenshotTradeButton } from "@/app/trades/screenshot-trade-button";
import { useAccountThemeToggle } from "@/components/preferences/preferences-provider";
import { TOUR_CLOSE_SHEETS_EVENT } from "@/lib/tour/signals";
import { PendingLinkHint } from "@/components/nav/pending-link-hint";

// The phone navigation (below `sm`, 640px): a bar fixed to the bottom of the
// screen, where a thumb reaches, in place of the top bar's six items that
// wrapped onto two rows and ate ~155px of every screen before any content.
//
// Four destinations and one action: Dashboard, Trades, + (add a trade),
// Analytics, More. Everything else lives one tap away in the More sheet, in
// the same groups as the desktop menu (src/lib/nav/links.ts), so the two
// cannot disagree about what exists.
//
// The bar marks itself with data-mobile-tabbar; globals.css reads that to pad
// the page (and lift the Ask composer) by the bar's height, so nothing ever
// sits underneath it.

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

const TAB_HREFS = ["/dashboard", "/trades", "/analytics"];

export function MobileTabBar() {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<null | "add" | "more">(null);

  // A navigation closes whichever sheet was open.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setSheet(null);
  }

  // The guided tour closes them when it points somewhere new.
  useEffect(() => {
    const close = () => setSheet(null);
    window.addEventListener(TOUR_CLOSE_SHEETS_EVENT, close);
    return () => window.removeEventListener(TOUR_CLOSE_SHEETS_EVENT, close);
  }, []);

  if (PUBLIC_PATHS.includes(pathname)) return null;

  const moreActive = !TAB_HREFS.some((h) => isActive(pathname, h));

  return (
    <>
      <nav
        data-mobile-tabbar
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-subtle dark:bg-background/95 sm:hidden print:hidden"
      >
        <ul className="grid h-[3.75rem] grid-cols-5">
          <Tab href="/dashboard" label="Dashboard" icon={<LayoutDashboard className="h-5 w-5" />} active={isActive(pathname, "/dashboard")} />
          <Tab href="/trades" label="Trades" icon={<List className="h-5 w-5" />} active={isActive(pathname, "/trades")} />
          <li className="flex items-center justify-center">
            <button
              type="button"
              aria-label="Add a trade"
              data-tour-id="nav-add"
              aria-haspopup="dialog"
              onClick={() => setSheet("add")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-sm active:scale-95 dark:text-zinc-950"
            >
              <Plus className="h-6 w-6" strokeWidth={2.25} />
            </button>
          </li>
          <Tab href="/analytics" label="Analytics" icon={<BarChart3 className="h-5 w-5" />} active={isActive(pathname, "/analytics")} />
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              data-tour-id="nav-more"
              onClick={() => setSheet("more")}
              className={`flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] ${
                moreActive ? "text-primary" : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              <Menu className="h-5 w-5" />
              More
            </button>
          </li>
        </ul>
      </nav>

      {sheet === "add" && (
        <Sheet title="Add a trade" onClose={() => setSheet(null)}>
          <AddSheet />
        </Sheet>
      )}

      {sheet === "more" && (
        <Sheet title="More" onClose={() => setSheet(null)}>
          <MoreLinks pathname={pathname} />
        </Sheet>
      )}
    </>
  );
}

/**
 * The + sheet: the same ways to add a trade as the Trades page header, which
 * phones don't show. The cash balance is fetched when it opens -- the bar
 * lives in the root layout, which doesn't load it -- so quick trade and the
 * screenshot scan prefill position size from cash, as they do on desktop.
 */
function AddSheet() {
  const [accountBalance, setAccountBalance] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/account/transactions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { balance?: number; hasTransactions?: boolean } | null) => {
        if (live && data?.hasTransactions && typeof data.balance === "number") setAccountBalance(data.balance);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-2 [&>button]:w-full [&>button]:py-3 [&>div]:items-stretch [&>div>button]:w-full [&>div>button]:py-3">
      <QuickTradeButton accountBalance={accountBalance} />
      <AddTradeButton label="Full trade form" />
      <ScreenshotTradeButton accountBalance={accountBalance} label="From a screenshot" />
      <Link
        href="/trades/import"
        data-tour-id="trades-import"
        className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 py-3 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
      >
        <FileUp className="h-4 w-4" /> From a file (CSV, Excel)
      </Link>
    </div>
  );
}

function Tab({ href, label, icon, active }: { href: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        data-tour-id={navLinkTourId(href)}
        aria-current={active ? "page" : undefined}
        className={`relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] ${
          active ? "text-primary" : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        {icon}
        {label}
        <PendingLinkHint className="rounded-lg" />
      </Link>
    </li>
  );
}

function MoreLinks({ pathname }: { pathname: string }) {
  const toggleTheme = useAccountThemeToggle();
  const { resolvedTheme } = useTheme();
  // Everything not already on the bar, in the desktop menu's groups.
  const groups = [
    { label: "Journal", links: PRIMARY_LINKS.filter((l) => !TAB_HREFS.includes(l.href)) },
    ...NAV_GROUPS.map((g) => ({ ...g, links: g.links.filter((l) => !TAB_HREFS.includes(l.href)) })),
  ].filter((g) => g.links.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{g.label}</h3>
          <div className="grid grid-cols-2 gap-2">
            {g.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                data-tour-id={navLinkTourId(l.href)}
                aria-current={isActive(pathname, l.href) ? "page" : undefined}
                className={`relative rounded-lg border px-3 py-2.5 text-sm ${
                  isActive(pathname, l.href)
                    ? "border-primary/50 bg-primary/10 text-zinc-900 dark:text-zinc-50"
                    : "border-zinc-200 text-zinc-700 dark:border-subtle dark:text-zinc-200"
                }`}
              >
                {l.label}
                <PendingLinkHint />
              </Link>
            ))}
          </div>
        </section>
      ))}
      <section data-tour-id="trades-export">
        {/* The Trades page's Export menu is hidden on phones with the rest
            of its header buttons. */}
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          <Download className="h-3.5 w-3.5" /> Export your trades
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["csv", "CSV"],
            ["xlsx", "Excel"],
            ["json", "JSON"],
          ].map(([format, label]) => (
            <a
              key={format}
              href={`/api/trades/export?format=${format}`}
              className="rounded-lg border border-zinc-200 px-3 py-2.5 text-center text-sm text-zinc-700 dark:border-subtle dark:text-zinc-200"
            >
              {label}
            </a>
          ))}
        </div>
      </section>
      <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 pt-4 dark:border-subtle">
        <Link
          href="/account"
          className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm text-zinc-700 dark:border-subtle dark:text-zinc-200"
        >
          <UserCircle className="h-4 w-4" /> Account
        </Link>
        <button
          type="button"
          onClick={() => void toggleTheme()}
          className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm text-zinc-700 dark:border-subtle dark:text-zinc-200"
        >
          {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </div>
    </div>
  );
}

/**
 * A panel that slides up from the bottom. A modal dialog: Esc and the
 * backdrop close it, focus moves in on open and back to the page on close.
 */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="sheet-panel absolute inset-x-0 bottom-0 overflow-y-auto rounded-t-2xl border-t border-zinc-200 bg-white px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none dark:border-subtle dark:bg-card"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
