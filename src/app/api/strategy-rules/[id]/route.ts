import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { deleteRule, updateRule } from "@/lib/plan-rules/queries";
import { rulePatchSchema } from "@/lib/plan-rules/schema";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  // The whole definition, not a partial: see the comment on rulePatchSchema
  // for why a partial patch cannot be validated coherently.
  const parsed = rulePatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid rule" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const updated = await updateRule(supabase, id, {
    ...parsed.data,
    number_value: parsed.data.number_value ?? null,
    number_value_max: parsed.data.number_value_max ?? null,
    text_value: parsed.data.text_value ?? null,
  });

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  // No explicit ownership check: RLS scopes the delete to the caller, so
  // another user's rule id matches nothing. Reported as 404 rather than 403
  // for the same reason as every other resource here -- a 403 would confirm
  // the id exists and belongs to someone.
  const deleted = await deleteRule(supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
