"use client";

import { useSyncExternalStore } from "react";
import type { DesignMode } from "@/components/design/design-flag";

// The flag is set once, before hydration, by the inline script in
// design-flag.tsx, and changing it goes through a full reload -- so there is
// nothing to subscribe to. The unsubscribe function is all this needs to be.
function subscribe() {
  return () => {};
}

function getSnapshot(): DesignMode {
  return document.documentElement.dataset.design === "v2" ? "v2" : "v1";
}

// The server has no localStorage and therefore no way to know the mode. V1 is
// the honest answer during render, and React re-reads the client snapshot once
// hydration is done.
function getServerSnapshot(): DesignMode {
  return "v1";
}

/**
 * Reads the active design mode for the rare component whose *markup* has to
 * differ between V1 and V2 -- a grid of cards becoming a real table, say,
 * which no amount of CSS can express.
 *
 * `useSyncExternalStore` rather than state-in-an-effect: it is built for
 * exactly this, reading a value the server cannot see. It renders the server
 * snapshot ("v1") during hydration so both sides agree, then swaps to the real
 * value immediately afterwards -- no mismatch, and no cascading render.
 *
 * Because of that one-frame swap, every caller must wrap the element whose
 * markup changes in `suppressHydrationWarning`.
 *
 * Prefer plain CSS scoped under `html[data-design="v2"]` over this hook. It
 * exists for the handful of genuine structural changes, and the budget for it
 * is roughly six components -- past that the CSS approach is being worked
 * around rather than used, which is worth stopping to reconsider.
 */
export function useDesign(): DesignMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
