import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isMissingColumnError } from "@/lib/settings/queries";
import { setShowTradeSummary } from "@/lib/settings/trade-summary";

// Setup -> Settings. One preference today: whether the Trades page shows its
// summary strip (migration 0052).

export async function PATCH(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(`preferences:${userId}`, 30, 60_000, "Too many changes in a row. Wait a moment and try again.");
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { showTradeSummary?: unknown } | null;
  if (typeof body?.showTradeSummary !== "boolean") {
    return NextResponse.json({ error: "showTradeSummary must be true or false" }, { status: 400 });
  }

  const supabase = await createClient();
  try {
    await setShowTradeSummary(supabase, userId, body.showTradeSummary);
  } catch (error) {
    // 0052 isn't applied: nothing to save it in yet.
    if (isMissingColumnError(error)) {
      return NextResponse.json({ error: "This setting isn't available yet." }, { status: 503 });
    }
    throw error;
  }
  return NextResponse.json({ ok: true, showTradeSummary: body.showTradeSummary });
}
