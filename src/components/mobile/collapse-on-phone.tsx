"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Secondary controls that fold behind one button on phones and are always
 * shown from `sm` up. Used where a desktop row of filters, tabs or panels
 * would wrap into a wall of chips on a 390px screen before any content.
 *
 * CSS decides the desktop case (`sm:flex`), not JS, so the server HTML is
 * right at every width and nothing jumps after hydration.
 */
export function CollapseOnPhone({
  label,
  activeCount = 0,
  className = "",
  children,
}: {
  label: string;
  /** Shown on the closed button, so an applied filter is never invisible. */
  activeCount?: number;
  /** Layout of the content when shown, e.g. "flex-col gap-4". */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200 sm:hidden"
      >
        <span>
          {label}
          {activeCount > 0 && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{activeCount} on</span>}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={`${open ? "flex" : "hidden"} sm:flex ${className}`}>{children}</div>
    </>
  );
}
