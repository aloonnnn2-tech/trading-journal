import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { ComponentsUnavailableError, deleteCommissionRule, updateCommissionRule } from "@/lib/commissions/queries";
import { commissionRulePatchSchema, validateFeeRange } from "@/lib/commissions/schema";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = commissionRulePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid rule" }, { status: 400 });
  }
  const rangeError = validateFeeRange(parsed.data);
  if (rangeError) {
    return NextResponse.json({ error: rangeError }, { status: 400 });
  }

  let rule;
  try {
    rule = await updateCommissionRule(supabase, id, parsed.data);
  } catch (error) {
    if (error instanceof ComponentsUnavailableError) {
      return NextResponse.json(
        { error: "Rules with several fee lines need a database update (migration 0055) that hasn't been applied yet." },
        { status: 503 },
      );
    }
    throw error;
  }
  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  return NextResponse.json(rule);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const deleted = await deleteCommissionRule(supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
