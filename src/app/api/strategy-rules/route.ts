import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { isMissingTableError } from "@/lib/supabase/errors";
import { createRule, listRulesForStrategy } from "@/lib/plan-rules/queries";
import { ruleCreateSchema } from "@/lib/plan-rules/schema";

// Plan rules are FREE -- no requirePaidUser() here, deliberately. Recording
// your own trading rules is core journal functionality; the paid AI features
// consume the result rather than gating it.

const MIGRATION_PENDING = {
  error:
    "Trading plan rules aren't set up on this server yet (a database migration is pending). Contact whoever deployed it.",
};

export async function GET(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const strategyId = new URL(request.url).searchParams.get("strategyId");
  if (!strategyId) {
    return NextResponse.json({ error: "Missing strategyId" }, { status: 400 });
  }

  const supabase = await createClient();
  // RLS scopes this, so another user's strategy id simply returns nothing.
  const rules = await listRulesForStrategy(supabase, strategyId);
  return NextResponse.json(rules);
}

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ruleCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid rule" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { strategy_id, ...rule } = parsed.data;

  // The strategy must be one the caller owns. RLS on `strategies` makes a
  // foreign id resolve to nothing, so this both validates and authorises --
  // without it a rule could be attached to a strategy id the user guessed,
  // and `strategy_rules` own RLS (which checks user_id) would not catch it.
  const { data: strategy } = await supabase
    .from("strategies")
    .select("id")
    .eq("id", strategy_id)
    .maybeSingle();
  if (!strategy) {
    return NextResponse.json({ error: "That strategy isn't available." }, { status: 404 });
  }

  try {
    const created = await createRule(supabase, userId, strategy_id, {
      ...rule,
      number_value: rule.number_value ?? null,
      number_value_max: rule.number_value_max ?? null,
      text_value: rule.text_value ?? null,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (isMissingTableError(err)) return NextResponse.json(MIGRATION_PENDING, { status: 503 });
    throw err;
  }
}
