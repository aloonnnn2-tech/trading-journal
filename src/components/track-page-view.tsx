"use client";

import { useEffect } from "react";
import { useAnalytics } from "@/lib/tracking/useAnalytics";

// Fires one named event on mount -- used for features worth tracking
// distinctly from the generic page_view already fired by <AnalyticsTracker />
// (e.g. dashboard_viewed, analytics_panel_viewed).
export function TrackPageView({ event }: { event: string }) {
  const { track } = useAnalytics();

  useEffect(() => {
    track(event);
  }, [event, track]);

  return null;
}
