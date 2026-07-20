import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createStrategy, listStrategies } from "@/lib/strategies/queries";

export async function GET() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const strategies = await listStrategies(supabase);
  return NextResponse.json(strategies);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const strategy = await createStrategy(supabase, userData.user.id, {
      name,
      description: body.description ?? null,
      color: body.color ?? null,
    });
    return NextResponse.json(strategy, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A strategy with that name already exists" }, { status: 400 });
  }
}
