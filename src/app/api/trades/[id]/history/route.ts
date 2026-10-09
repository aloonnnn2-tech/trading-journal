import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { listTradeHistory } from "@/lib/trades/history";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same answer as every other trade route for a trade that isn't yours:
  // 404, rather than an empty list that reads like "no edits yet". A
  // malformed id never reaches Postgres (it would 500 on the uuid cast).
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();

  const { data: trade } = await supabase.from("trades").select("id").eq("id", id).maybeSingle();
  if (!trade) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const history = await listTradeHistory(supabase, id);
  return NextResponse.json(history);
}
