import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { deleteStrategy, updateStrategy } from "@/lib/strategies/queries";
import { strategyPatchSchema } from "@/lib/strategies/schema";
import { log } from "@/lib/observability/log";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const parsed = strategyPatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid strategy" },
      { status: 400 },
    );
  }

  let updated;
  try {
    updated = await updateStrategy(supabase, id, {
      name: parsed.data.name,
      description: parsed.data.description,
      color: parsed.data.color,
      sort_order: parsed.data.sort_order,
    });
  } catch (error) {
    // Only a unique-name clash is the user's to fix; anything else is ours.
    if ((error as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "A strategy with that name already exists" }, { status: 400 });
    }
    log.error("strategies.update_failed", { strategyId: id, error });
    return NextResponse.json({ error: "Could not save the strategy." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const deleted = await deleteStrategy(supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
