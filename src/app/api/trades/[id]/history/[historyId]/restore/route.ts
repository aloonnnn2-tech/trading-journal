import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { restoreTradeVersion } from "@/lib/trades/history";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; historyId: string }> },
) {
  const { id, historyId } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const trade = await restoreTradeVersion(supabase, id, historyId);
  return NextResponse.json(trade);
}
