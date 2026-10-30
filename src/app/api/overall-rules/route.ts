import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { isMissingTableError } from "@/lib/supabase/errors";
import { rateLimit } from "@/lib/rate-limit";
import { rowLimitResponse } from "@/lib/limits";
import { createOverallRule, listOverallRules } from "@/lib/overall-rules/queries";
import { overallRuleSchema } from "@/lib/overall-rules/schema";

// Overall rules (0081) are FREE, like plan rules: writing down your own
// rules and seeing whether you kept them is journal functionality. Only the
// AI review that discusses them is paid.

const MIGRATION_PENDING = {
  error: "Overall rules aren't switched on yet (migration 0081 still needs to be run).",
};

export async function GET() {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createClient();
  const rules = await listOverallRules(supabase);
  if (rules === null) return NextResponse.json(MIGRATION_PENDING, { status: 503 });
  return NextResponse.json(rules);
}

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await rateLimit(`overall-rules-write:${userId}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many changes in a row. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = overallRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid rule" }, { status: 400 });
  }

  const supabase = await createClient();
  try {
    return NextResponse.json(await createOverallRule(supabase, userId, parsed.data), { status: 201 });
  } catch (err) {
    if (isMissingTableError(err)) return NextResponse.json(MIGRATION_PENDING, { status: 503 });
    const limited = rowLimitResponse(err);
    if (limited) return limited;
    throw err;
  }
}
