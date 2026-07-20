import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setTradeStrategies } from "@/lib/strategies/queries";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const strategyIds = Array.isArray(body.strategyIds) ? (body.strategyIds as string[]) : [];

  try {
    await setTradeStrategies(supabase, id, strategyIds);
  } catch {
    return NextResponse.json({ error: "One or more strategies were not found" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
