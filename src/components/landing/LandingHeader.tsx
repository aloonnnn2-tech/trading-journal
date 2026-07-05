"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export function LandingHeader() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Standard next-themes hydration guard: resolvedTheme is unknown on the
  // server, so the theme icon only renders once mounted on the client.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="sticky top-0 z-50 flex items-center justify-between border-b border-zinc-200 dark:border-subtle bg-white/85 dark:bg-background/85 px-6 py-3.5 backdrop-blur-md sm:px-10"
    >
      <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        <BrandMark className="h-6 w-6" />
        Trading Journal
      </Link>
      <nav className="hidden items-center gap-6 sm:flex">
        <Link
          href="/#features"
          className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Features
        </Link>
        <Link
          href="/#pricing"
          className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Pricing
        </Link>
      </nav>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          title="Toggle theme"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          {mounted && (resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />)}
        </button>
        <Link
          href="/sign-in"
          className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Log in
        </Link>
        <Link
          href="/sign-up"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110"
        >
          Start journaling free
        </Link>
      </div>
    </motion.header>
  );
}
