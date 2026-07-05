import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listTradeHistory } from "@/lib/trades/history";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const history = await listTradeHistory(supabase, id);
  return NextResponse.json(history);
}
