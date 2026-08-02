import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { createStrategy, listStrategies } from "@/lib/strategies/queries";
import { strategyCreateSchema } from "@/lib/strategies/schema";

export async function GET() {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const strategies = await listStrategies(supabase);
  return NextResponse.json(strategies);
}

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = strategyCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid strategy" },
      { status: 400 },
    );
  }

  try {
    const strategy = await createStrategy(supabase, userId, {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      color: parsed.data.color ?? null,
    });
    return NextResponse.json(strategy, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A strategy with that name already exists" }, { status: 400 });
  }
}
