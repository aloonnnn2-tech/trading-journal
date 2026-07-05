"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/brand-mark";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trades", label: "Trades" },
  { href: "/analytics", label: "Analytics" },
  { href: "/insights", label: "Insights" },
  { href: "/ask", label: "Ask" },
  { href: "/emotions", label: "Emotions" },
  { href: "/fields", label: "Fields" },
];

// Marketing-adjacent pages with no logged-in-only content — the app nav
// (Dashboard/Trades/etc.) shouldn't render on these for logged-out visitors.
const PUBLIC_PATHS = ["/", "/sign-in", "/sign-up", "/privacy", "/terms", "/contact"];

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Standard next-themes hydration guard: resolvedTheme is unknown on the
  // server, so the theme icon only renders once mounted on the client.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

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
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 dark:border-subtle bg-white/85 dark:bg-background/85 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 px-6 sm:px-8">
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
          <Link
            href="/dashboard"
            className="mr-4 flex shrink-0 items-center gap-2.5 py-3.5 font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            <BrandMark className="h-6 w-6" />
            <span className="hidden sm:inline">Trading Journal</span>
          </Link>
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
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
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            title="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            {mounted && (resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />)}
          </button>
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
