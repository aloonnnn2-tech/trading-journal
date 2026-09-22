"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { PUBLIC_PATHS } from "@/lib/public-paths";
import { useAnalytics, getSessionId } from "@/lib/tracking/useAnalytics";
import { startClickCapture } from "@/lib/tracking/click-capture";

// Must match the 30-second increment in record_heartbeat() (migration 0045):
// the database adds a fixed 30s per beat rather than measuring elapsed time,
// so beating at any other interval silently skews time-on-site.
const HEARTBEAT_INTERVAL_MS = 30_000;
const SESSION_STARTED_KEY = "tj-analytics-session-started";

// Mounted once in the root layout, next to <KeyboardShortcuts />. Fires
// session_start (once per browser session) and page_view on every route
// change, and pings a heartbeat every ~30s while the tab is visible so
// analytics_sessions.duration_seconds reflects real active time rather
// than raw open-to-close span. No-ops on public/marketing pages, same gate
// NavBar and KeyboardShortcuts already use -- there's no signed-in user to
// attribute events to there, and only registered-user activity is tracked.
export function AnalyticsTracker() {
  const pathname = usePathname();
  const { track, trackBatch, heartbeat } = useAnalytics();
  const isPublicPage = PUBLIC_PATHS.includes(pathname);

  // Click autocapture rides the same gate as everything else here: it is
  // never installed on a public page, so a logged-out visitor's clicks on the
  // homepage are not recorded -- that would be the anonymous tracking the
  // privacy policy rules out. See src/lib/tracking/click-capture.ts for how
  // labels are kept free of user content.
  useEffect(() => {
    if (isPublicPage) return;
    return startClickCapture(trackBatch);
  }, [isPublicPage, trackBatch]);

  useEffect(() => {
    if (isPublicPage) return;
    getSessionId();
    if (sessionStorage.getItem(SESSION_STARTED_KEY) === "1") return;
    // Only mark "started" once the request actually lands -- a logged-out
    // visitor briefly hitting a protected URL (bookmark, shared link, or
    // just this effect racing the auth redirect) gets a 401 here; marking
    // the flag before knowing that would permanently swallow session_start
    // for the rest of this tab's session, even after signing in.
    track("session_start").then((ok) => {
      if (ok) sessionStorage.setItem(SESSION_STARTED_KEY, "1");
    });
  }, [isPublicPage, track]);

  useEffect(() => {
    if (isPublicPage) return;
    track("page_view", { path: pathname });
  }, [pathname, isPublicPage, track]);

  useEffect(() => {
    if (isPublicPage) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") heartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isPublicPage, heartbeat]);

  return null;
}
