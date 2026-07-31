"use client";

import { useCallback } from "react";

const SESSION_ID_KEY = "tj-analytics-session-id";

export function getSessionId(): string {
  let id = sessionStorage.getItem(SESSION_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}

// Fire-and-forget wrappers around the tracking API routes -- most callers
// never await the returned promise, an analytics call must never block or
// fail a UI interaction. `track` still resolves to whether it actually
// landed, for the one caller (AnalyticsTracker's session_start) that needs
// to know before recording "already tracked" locally.
export function useAnalytics() {
  const track = useCallback((eventName: string, props?: Record<string, unknown>) => {
    return fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ eventName, props, sessionId: getSessionId() }),
    })
      .then((res) => res.ok)
      .catch(() => {
        // Best-effort -- see src/lib/tracking/log.ts for the same reasoning server-side.
        return false;
      });
  }, []);

  const heartbeat = useCallback(() => {
    fetch("/api/analytics/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ sessionId: getSessionId() }),
    }).catch(() => {});
  }, []);

  return { track, heartbeat };
}
