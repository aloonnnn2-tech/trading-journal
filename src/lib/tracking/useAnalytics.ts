"use client";

// The browser half of analytics. What may be sent, and how to add an event:
// src/lib/tracking/events.ts and docs/analytics-events.md.

import { useCallback } from "react";
import type { z } from "zod";
import type { CLIENT_EVENTS, ClientEventName } from "@/lib/tracking/events";

/** The props an event takes, straight from its schema in events.ts. */
export type ClientEventProps<E extends ClientEventName> = z.input<(typeof CLIENT_EVENTS)[E]["props"]>;

const SESSION_ID_KEY = "tj-analytics-session-id";

/**
 * Ends the current analytics session so the next visit starts a new one.
 *
 * Called on sign-out. The id lives in sessionStorage, which survives an
 * account switch in the same tab -- and since record_heartbeat (0045) credits
 * a beat only to the session's own owner, the next user's beats were silently
 * dropped against the previous user's row, and their events pointed at a
 * session belonging to someone else. Clearing it here keeps one session id to
 * one account.
 */
export function endSession(): void {
  try {
    sessionStorage.removeItem(SESSION_ID_KEY);
    sessionStorage.removeItem("tj-analytics-session-started");
  } catch {
    // Private mode or blocked storage -- nothing to clear, nothing to fix.
  }
}

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
  // Only names in src/lib/tracking/events.ts compile, with the props that
  // event's schema allows -- the server validates the same schema.
  const track = useCallback(<E extends ClientEventName>(eventName: E, props?: ClientEventProps<E>) => {
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

  // Several events in one request -- what click autocapture sends. keepalive
  // so a flush fired on pagehide survives the navigation that triggered it.
  const trackBatch = useCallback(
    (events: { eventName: ClientEventName; props?: Record<string, unknown> }[]) => {
      if (events.length === 0) return;
      fetch("/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ sessionId: getSessionId(), events }),
      }).catch(() => {});
    },
    [],
  );

  return { track, trackBatch, heartbeat };
}

/**
 * "Left the app on <page>": one event when the tab is hidden -- closed,
 * switched away from, or backgrounded on a phone. sendBeacon, because it is
 * the one request a browser promises to deliver while the page goes away;
 * a fetch started then is often cancelled. Falls back to a keepalive fetch.
 * The admin's "Left on" for a session is its last one of these.
 */
export function sendPageExit(path: string): void {
  try {
    const body = JSON.stringify({ sessionId: getSessionId(), eventName: "page_exit", props: { path } });
    const sent =
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon("/api/analytics/track", new Blob([body], { type: "application/json" }));
    if (!sent) {
      fetch("/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body,
      }).catch(() => {});
    }
  } catch {
    // Best-effort, like every analytics call.
  }
}
