"use client";

import { useState, type ReactNode } from "react";

/**
 * A list that shows its first three items on a phone, with "Show all" for the
 * rest; from `sm` up it always shows everything. For pages that are one long
 * run of same-shaped cards (strategy scorecards, detected mistakes) -- on a
 * 390px screen they stack into thousands of pixels of scrolling.
 *
 * Renders the list container itself (pass its layout classes as
 * `className`), because the hiding is a CSS rule on its direct children:
 * server HTML is right at every width, nothing jumps on hydration.
 */
export function ShowMoreOnPhone({
  count,
  noun,
  className = "",
  children,
}: {
  /** How many direct children the list has. */
  count: number;
  /** What the items are, for the button: "scorecards". */
  noun: string;
  className?: string;
  children: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const folds = !all && count > 3;
  return (
    <>
      <div className={`${className} ${folds ? "max-sm:[&>*:nth-child(n+4)]:hidden" : ""}`}>{children}</div>
      {folds && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="rounded-lg border border-zinc-300 py-2.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200 sm:hidden"
        >
          Show all {count} {noun}
        </button>
      )}
    </>
  );
}
