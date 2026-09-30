import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { getTrade, updateTrade } from "@/lib/trades/queries";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { enforceRateLimit } from "@/lib/rate-limit";

// Which fee a trade pays (migration 0056): "auto" -- matched from the user's
// fees, as always; a fee id -- that fee, whatever matching would pick; or
// "none" -- no fee (a hand-entered commission of 0, which the rest of the app
// already treats as pinned).
//
// Separate from the autosave PATCH on purpose: that route falls back to
// dropping the commission columns when one is missing, and a pending 0056
// must not be able to trigger that.

const bodySchema = z.object({ fee: z.union([z.literal("auto"), z.literal("none"), z.uuid()]) }).strict();

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await enforceRateLimit(`trade-fee:${userId}`, 60, 60_000, "Too many changes in a row. Wait a moment.");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Expected { fee: "auto" | "none" | <fee id> }' }, { status: 400 });
  const { fee } = parsed.data;

  const supabase = await createClient();
  // RLS: someone else's trade doesn't resolve -> 404.
  const trade = await getTrade(supabase, id);
  if (!trade) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ruleId = fee === "auto" || fee === "none" ? null : fee;
  if (ruleId) {
    // RLS confines this to the caller's own fees, so a foreign id is "not
    // found" (the 0056 trigger is the backstop).
    const { data: rule } = await supabase.from("commission_rules").select("id").eq("id", ruleId).maybeSingle();
    if (!rule) return NextResponse.json({ error: "That fee doesn't exist." }, { status: 400 });
  }

  const { error } = await supabase.from("trades").update({ commission_rule_id: ruleId }).eq("id", id);
  if (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json(
        { error: "Choosing a fee per trade needs a database update (migration 0056) that hasn't been applied yet." },
        { status: 503 },
      );
    }
    throw error;
  }

  // Re-derive the commission and P/L with the choice in place: an explicit
  // null releases a hand-entered commission and recomputes from the fees;
  // "none" pins 0.
  const updated = await updateTrade(supabase, id, { core: { commission: fee === "none" ? 0 : null } });
  return NextResponse.json(updated);
}
