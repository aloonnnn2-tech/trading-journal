import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { duplicateTrade } from "@/lib/trades/queries";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const duplicate = await duplicateTrade(supabase, id);
  return NextResponse.json(duplicate, { status: 201 });
}
