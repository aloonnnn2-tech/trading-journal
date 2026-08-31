import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { deleteApiKey, setApiKeyActive } from "@/lib/ai-keys/queries";

const patchSchema = z.object({ is_active: z.boolean() });

// Enables or disables a stored key without deleting it. This is what makes
// the `is_active` column mean anything from the UI's side -- before this it
// was respected by every read but settable by nothing.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { is_active: boolean }" }, { status: 400 });
  }

  const updated = await setApiKeyActive(gate.supabase, id, parsed.data.is_active);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  // No explicit ownership check: RLS scopes the delete to the caller, so
  // another user's key id simply matches nothing. That is reported as 404
  // rather than 403 on purpose -- a 403 would confirm the id exists and
  // belongs to someone, which is enough to enumerate valid key ids.
  const deleted = await deleteApiKey(gate.supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
