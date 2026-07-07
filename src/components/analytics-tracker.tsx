"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { PUBLIC_PATHS } from "@/lib/public-paths";
import { useAnalytics, getSessionId } from "@/lib/tracking/useAnalytics";

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
  const { track, heartbeat } = useAnalytics();
  const isPublicPage = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (isPublicPage) return;
    getSessionId();
    if (sessionStorage.getItem(SESSION_STARTED_KEY) === "1") return;
    sessionStorage.setItem(SESSION_STARTED_KEY, "1");
    track("session_start");
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
