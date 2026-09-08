import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { isMissingTableError } from "@/lib/supabase/errors";
import { createGoal, listGoals } from "@/lib/goals/queries";
import { goalCreateSchema, toGoalRow } from "@/lib/goals/schema";

// Goals are FREE, like the plan rules they are built on: committing to a rule
// and checking whether you kept it is a recording capability, not analytics.

const MIGRATION_PENDING = {
  error:
    "Goals aren't set up on this server yet (a database migration is pending). Contact whoever deployed it.",
};

export async function GET() {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  return NextResponse.json(await listGoals(supabase));
}

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = goalCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid goal" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  try {
    return NextResponse.json(await createGoal(supabase, userId, toGoalRow(parsed.data)), {
      status: 201,
    });
  } catch (err) {
    if (isMissingTableError(err)) return NextResponse.json(MIGRATION_PENDING, { status: 503 });
    throw err;
  }
}
