"use client";

import { useEffect } from "react";

// Counts one anonymous view of a public page. Fires once per mount and stores
// NOTHING on the device -- no cookie, no sessionStorage, no localStorage --
// which is the whole reason it needs no consent banner (see the privacy
// policy and SECURITY.md §4). The knock-on is accepted and intentional: a
// refresh counts again, because deduplicating would require remembering the
// visitor, and remembering the visitor is the thing this avoids.
//
// Mounted only on public pages. Signed-in users never reach it on the
// homepage: HomeV2 redirects them to /dashboard server-side before render.
export function PublicViewBeacon({ path }: { path: string }) {
  useEffect(() => {
    fetch("/api/analytics/public-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ path }),
    }).catch(() => {
      // Best-effort. A failed count must never affect the page.
    });
  }, [path]);

  return null;
}
