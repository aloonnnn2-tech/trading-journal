import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { setTradeStrategies } from "@/lib/strategies/queries";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const strategyIds = Array.isArray(body.strategyIds) ? (body.strategyIds as string[]) : [];

  try {
    await setTradeStrategies(supabase, id, strategyIds);
  } catch {
    return NextResponse.json({ error: "One or more strategies were not found" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
