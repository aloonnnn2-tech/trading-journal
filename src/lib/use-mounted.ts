"use client";

import { useSyncExternalStore } from "react";

/** Never changes, so React never re-subscribes and never re-renders for it. */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * False during SSR and the first client render, true afterwards.
 *
 * Used to defer timezone- and clock-dependent text in client components.
 * React renders those twice: once on Netlify, where the runtime is UTC, and
 * once in the browser, in the user's own zone. Any text derived from local
 * date parts or from "now" can differ between the two and trips React
 * error #418 (hydration mismatch), which re-renders the whole subtree.
 *
 * `formatDate` formats from LOCAL date parts on purpose -- the whole app
 * buckets by the trader's own calendar day rather than UTC's (see
 * local-day.ts), so it must not be switched to UTC getters to silence this.
 * `formatRelative` additionally calls Date.now(), which differs between the
 * two renders by however long hydration took. Both produced #418 on every
 * load of /admin/users, and the same shape existed on the reports page, the
 * review cards, the cash card and the dashboard calendar.
 *
 * Built on useSyncExternalStore rather than useEffect + setState: this is
 * exactly the "server and client disagree" case it exists for, and it avoids
 * the cascading render that setting state in an effect causes.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
