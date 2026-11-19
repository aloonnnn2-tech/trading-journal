import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isHeardFromAnswer } from "@/lib/onboarding/heard-from";
import { log } from "@/lib/observability/log";

// Saves the answer to "How did you hear about us?" on the signed-in account's
// own metadata (see src/lib/onboarding/heard-from.ts). Only the fixed options
// or "skipped" are accepted.

const bodySchema = z.object({ answer: z.string().max(20).refine(isHeardFromAnswer, "Unknown answer") }).strict();

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await enforceRateLimit(`heard-from:${userId}`, 10, 60_000, "Too many answers in a row. Wait a moment.");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick one of the options." }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    data: { heard_from: parsed.data.answer, heard_from_at: new Date().toISOString() },
  });
  if (error) {
    log.error("heard-from: could not save the answer", { message: error.message });
    return NextResponse.json({ error: "Couldn't save that. It won't be asked again this visit." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
