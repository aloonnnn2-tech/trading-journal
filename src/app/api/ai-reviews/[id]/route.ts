import { NextResponse } from "next/server";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { deleteReview } from "@/lib/ai-reviews/queries";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  // No explicit ownership check: RLS scopes the delete to the caller, so
  // another user's review id simply matches nothing. Reported as 404 rather
  // than 403 for the same reason as the key routes -- a 403 would confirm the
  // id exists and belongs to someone, which is enough to enumerate valid ids.
  const deleted = await deleteReview(gate.supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
