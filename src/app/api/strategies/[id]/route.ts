import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteStrategy, updateStrategy } from "@/lib/strategies/queries";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  try {
    const updated = await updateStrategy(supabase, id, {
      name: body.name,
      description: body.description,
      color: body.color,
      sort_order: body.sort_order,
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "A strategy with that name already exists" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted = await deleteStrategy(supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
