"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import {
  ANNOUNCEMENT_ID,
  ANNOUNCEMENT_STORAGE_KEY,
  isAnnouncementDismissed,
} from "@/components/landing/v2/announcement";

// The homepage's announcement bar, first in the target order (Phase 2C of
// docs/design-audit.md). It points at the paid-plan waitlist form (2B).
//
// The claim in it -- AI reviews that grade execution, not outcome -- is the
// paid plan's own, already on the page: the review card says each trade is
// "scored on how it was executed, not on whether it won".
//
// Hiding it for someone who closed it happens twice, on purpose:
//  - on a full page load, ANNOUNCEMENT_SCRIPT (rendered just before this by
//    HomeV2) marks <html> before first paint and globals.css hides the bar,
//    so it never flashes;
//  - on a client-side navigation back to "/", that inline script doesn't run
//    (React doesn't execute scripts it renders on the client), so this
//    component checks storage itself after mount.
export function AnnouncementBar() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY);
    } catch {}
    // Reading an external store once on mount, not deriving render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isAnnouncementDismissed(stored)) setDismissed(true);
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(ANNOUNCEMENT_STORAGE_KEY, ANNOUNCEMENT_ID);
    } catch {}
    setDismissed(true);
  };

  return (
    <div
      data-announcement
      role="region"
      aria-label="Announcement"
      className="relative border-b border-zinc-200 bg-band-cta px-10 py-2 text-center text-[13px] text-zinc-700 dark:border-subtle dark:text-zinc-300"
    >
      <span>Paid plan in the works: AI reviews that grade execution, not outcome</span>
      <Link
        href="/#waitlist"
        className="ml-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
      >
        Join the waitlist
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
