import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCommissionRule, listCommissionRules } from "@/lib/commissions/queries";
import { commissionRuleSchema, validateFeeRange } from "@/lib/commissions/schema";

export async function GET() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = await listCommissionRules(supabase);
  return NextResponse.json(rules);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = commissionRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid rule" }, { status: 400 });
  }
  const rangeError = validateFeeRange(parsed.data);
  if (rangeError) {
    return NextResponse.json({ error: rangeError }, { status: 400 });
  }

  try {
    const rule = await createCommissionRule(supabase, userData.user.id, parsed.data);
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    // The commission tables only exist once migration 0022 has been pasted
    // into the SQL editor by hand -- say so explicitly instead of a bare 500.
    if (code === "PGRST205" || code === "42P01") {
      return NextResponse.json(
        { error: "Commissions aren't set up yet — migration 0022 still needs to be run." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Could not create the rule" }, { status: 500 });
  }
}
