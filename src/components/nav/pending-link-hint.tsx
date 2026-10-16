"use client";

import { useLinkStatus } from "next/link";

// Shows that a click on a link landed while the next page is still being
// built on the server. Without it, a tab or menu link looked dead for one to
// three seconds on the live site (measured 2026-10-16: Trades status tabs
// 1.1-3.1s, Goals/Reports ~1.1s), and people clicked again.
//
// Put it INSIDE a <Link> whose className includes `relative` (useLinkStatus
// reads the nearest Link). It covers the link, pointer-events off, so it
// changes nothing about the layout -- the docs' advice for these hints --
// and is invisible until that link's navigation is pending.
export function PendingLinkHint({ className = "rounded-[inherit]" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      data-pending-hint={pending ? "on" : undefined}
      // The pulse only while pending: animate-pulse animates opacity itself,
      // so left on it overrode opacity-0 and showed the ring on every link.
      className={`pointer-events-none absolute inset-0 ${className} ring-2 ring-primary/50 transition-opacity duration-150 ${
        pending ? "opacity-100 motion-safe:animate-pulse" : "opacity-0"
      }`}
    />
  );
}
