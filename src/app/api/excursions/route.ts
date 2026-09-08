import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { isMissingTableError } from "@/lib/supabase/errors";
import { computeExcursions } from "@/lib/excursions/queries";
import { rateLimit } from "@/lib/rate-limit";

// Recomputing excursions makes one outbound request PER DISTINCT SYMBOL in the
// journal, to an unofficial endpoint, from this app's IP. That is the whole
// reason this is paid-gated and throttled harder than anything else here: a
// handful of clients looping it would put the shared IP at risk for everyone.
//
// Three per five minutes is generous for a deliberate action whose result is
// stored -- there is no reason to run it twice in a row.
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 5 * 60_000;

// The work scales with the number of distinct symbols, each a network round
// trip. Kept under the platform ceiling so a slow provider surfaces as this
// app's own error rather than a generic timeout page.
export const maxDuration = 26;

export async function POST() {
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  const limit = rateLimit(`excursions:${gate.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Excursions were just recalculated — give it a few minutes before running again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const summary = await computeExcursions(gate.supabase, gate.userId);
    return NextResponse.json(summary);
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json(
        {
          error:
            "MAE/MFE isn't set up on this server yet (a database migration is pending). Contact whoever deployed it.",
        },
        { status: 503 },
      );
    }
    throw err;
  }
}
