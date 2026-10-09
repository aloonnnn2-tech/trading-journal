"use client";

import { useEffect } from "react";
import { useAnalytics } from "@/lib/tracking/useAnalytics";
import type { ClientEventName } from "@/lib/tracking/events";
import { isTourActive } from "@/lib/tracking/click-capture";

// Fires one named event on mount -- used for features worth tracking
// distinctly from the generic page_view already fired by <AnalyticsTracker />
// (e.g. dashboard_viewed, analytics_panel_viewed).
export function TrackPageView({ event }: { event: Extract<ClientEventName, `${string}_viewed`> }) {
  const { track } = useAnalytics();

  useEffect(() => {
    // A page the tour walked the user to isn't a visit of their own.
    if (isTourActive(document)) return;
    track(event);
  }, [event, track]);

  return null;
}
