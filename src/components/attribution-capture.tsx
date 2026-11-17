"use client";

import { useEffect } from "react";
import { rememberAttribution } from "@/lib/tracking/attribution";

// Mounted once in the root layout. Notes, in this tab only, which link or site
// first brought the visitor, so a sign-up can say where it came from. It sends
// nothing: see src/lib/tracking/attribution.ts.
export function AttributionCapture() {
  useEffect(() => {
    rememberAttribution();
  }, []);
  return null;
}
