import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";

/**
 * The user answered "At what price did it fill?" (src/lib/trades/fill-check.ts):
 * stop asking. The price itself, if changed, goes through the normal autosave
 * PATCH, which recomputes P/L; this only records the answer.
 *
 * Its own route rather than an editable core field, so the flag never rides
 * into CSV exports, duplicated trades or the hide-a-field settings. The RLS
 * client limits it to the caller's own trades; only a trade that is being
 * asked about (false) can be marked.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Same check as the history route: a malformed id never reaches Postgres.
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trades")
    .update({ fill_price_confirmed: true })
    .eq("id", id)
    .eq("fill_price_confirmed", false)
    .select()
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not save that." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
