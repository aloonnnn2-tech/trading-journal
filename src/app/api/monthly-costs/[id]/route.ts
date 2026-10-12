import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { deleteMonthlyCost, updateMonthlyCost } from "@/lib/monthly-costs/queries";
import { monthlyCostPatchSchema } from "@/lib/monthly-costs/schema";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = await enforceRateLimit(`monthly-costs:${userId}`, 30, 60_000, "Too many changes in a row. Wait a moment.");
  if (limited) return limited;

  const parsed = monthlyCostPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });

  // RLS: someone else's cost matches nothing -> 404.
  const updated = await updateMonthlyCost(await createClient(), id, parsed.data);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

/** Stops the cost. Money already taken stays in the cash ledger. */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const deleted = await deleteMonthlyCost(await createClient(), id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
