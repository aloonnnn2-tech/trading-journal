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

// Fire-and-forget wrappers around the tracking API routes. Never awaited by
// callers -- an analytics call must never block or fail a UI interaction.
export function useAnalytics() {
  const track = useCallback((eventName: string, props?: Record<string, unknown>) => {
    fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ eventName, props, sessionId: getSessionId() }),
    }).catch(() => {
      // Best-effort -- see src/lib/tracking/log.ts for the same reasoning server-side.
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
