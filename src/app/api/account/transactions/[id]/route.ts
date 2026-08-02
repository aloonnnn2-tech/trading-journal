import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { deleteAccountTransaction, getAccountBalance } from "@/lib/account/queries";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const deleted = await deleteAccountTransaction(supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const balance = await getAccountBalance(supabase);
  void logEvent(supabase, userId, SERVER_SESSION_ID, "account_transaction_deleted", {
    transactionId: id,
  });

  return NextResponse.json({ ok: true, ...balance });
}
