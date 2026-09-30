import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isMissingTableError } from "@/lib/supabase/errors";
import { createMonthlyCost, listMonthlyCosts, takeDueMonthlyCosts } from "@/lib/monthly-costs/queries";
import { monthlyCostSchema } from "@/lib/monthly-costs/schema";

// Monthly costs (0057): platform, data or account fees taken from cash each
// month. See src/lib/monthly-costs/queries.ts for how a month is taken.

const MAX_COSTS = 30;

export async function GET() {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createClient();
  const costs = await listMonthlyCosts(supabase);
  if (costs === null) return NextResponse.json({ error: "Not available yet (migration 0057)." }, { status: 503 });
  return NextResponse.json(costs);
}

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await enforceRateLimit(`monthly-costs:${userId}`, 30, 60_000, "Too many changes in a row. Wait a moment.");
  if (limited) return limited;

  const parsed = monthlyCostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid monthly cost" }, { status: 400 });
  }

  const supabase = await createClient();
  const existing = await listMonthlyCosts(supabase);
  if (existing === null) {
    return NextResponse.json(
      { error: "Monthly costs need a database update (migration 0057) that hasn't been applied yet." },
      { status: 503 },
    );
  }
  if (existing.length >= MAX_COSTS) {
    return NextResponse.json({ error: `You can have up to ${MAX_COSTS} monthly costs.` }, { status: 400 });
  }

  try {
    const cost = await createMonthlyCost(supabase, userId, parsed.data);
    // A cost that started in the past is taken for the months already due.
    const taken = await takeDueMonthlyCosts(supabase, userId);
    return NextResponse.json({ cost, taken }, { status: 201 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: "Monthly costs need migration 0057." }, { status: 503 });
    }
    throw error;
  }
}
