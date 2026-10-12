import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { buildDemoPayload } from "@/lib/demo/payload";

// The optional demo journal (Phase 4D). Three answers, each a database
// function from migration 0051 that checks the account's state itself and
// does its work in one transaction:
//
//   start    "Yes" to "Start with a demo journal?": seeds it
//   decline  "No": never offered again
//   finish   "Switch to my own journal": clears it, never offered again
//
// The functions refuse anything out of order (starting twice, finishing a
// demo that isn't there), which comes back as 409 rather than a 500.

type Action = "start" | "decline" | "finish";
const FUNCTIONS: Record<Action, string> = {
  start: "seed_demo_journal",
  decline: "decline_demo_journal",
  finish: "finish_demo_journal",
};

/** A function that doesn't exist: 0051 hasn't been applied. */
function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

const bodySchema = z.object({ action: z.enum(["start", "decline", "finish"]) }).strict();

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Each answer happens once per account; this only stops a stuck button or
  // a script from hammering a seed that writes sixty trades.
  const limited = await enforceRateLimit(`demo:${userId}`, 10, 60_000, "Too many requests. Wait a moment and try again.");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const { action } = parsed.data;

  const supabase = await createClient();

  // Screenshots uploaded while trying the demo: their rows go with the
  // trades in finish_demo_journal, but the files live in Storage. Listed
  // before the delete, removed after it succeeds.
  let imagePaths: string[] = [];
  if (action === "finish") {
    const { data } = await supabase.from("trade_images").select("storage_path");
    imagePaths = (data ?? []).map((row) => row.storage_path as string).filter(Boolean);
  }

  const { error } =
    action === "start"
      ? await supabase.rpc(FUNCTIONS.start, { payload: buildDemoPayload() })
      : await supabase.rpc(FUNCTIONS[action]);

  if (error) {
    if (isMissingFunction(error)) {
      return NextResponse.json({ error: "The demo journal isn't available yet." }, { status: 503 });
    }
    if (error.code === "P0001") {
      return NextResponse.json({ error: "Already answered.", reason: error.hint ?? null }, { status: 409 });
    }
    throw error;
  }

  if (imagePaths.length > 0) {
    // Best effort: the journal is already cleared, and an orphaned file is
    // invisible to the user (its row is gone).
    await supabase.storage.from("trade-images").remove(imagePaths).catch(() => {});
  }

  const state = action === "start" ? "active" : action === "decline" ? "declined" : "done";
  return NextResponse.json({ ok: true, state });
}
