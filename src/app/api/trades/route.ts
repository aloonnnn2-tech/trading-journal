import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createBlankTrade } from "@/lib/trades/queries";

export async function POST() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const trade = await createBlankTrade(supabase, userData.user.id);
  return NextResponse.json(trade, { status: 201 });
}
