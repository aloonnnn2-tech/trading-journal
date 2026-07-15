import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteAccountTransaction, getAccountBalance } from "@/lib/account/queries";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted = await deleteAccountTransaction(supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const balance = await getAccountBalance(supabase);
  void logEvent(supabase, userData.user.id, SERVER_SESSION_ID, "account_transaction_deleted", {
    transactionId: id,
  });

  return NextResponse.json({ ok: true, ...balance });
}
