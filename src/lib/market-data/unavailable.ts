import { NextResponse } from "next/server";

/**
 * The answer when Yahoo is down or slow (yahoo.ts throws
 * UpstreamUnavailableError). Distinct from a 404 "no price history": the
 * symbol is fine, so the chart must not tell the user to correct it.
 */
export function marketDataUnavailable(): NextResponse {
  return NextResponse.json(
    { error: "Market data is temporarily unavailable. Try again in a minute." },
    { status: 503, headers: { "Retry-After": "30" } },
  );
}
