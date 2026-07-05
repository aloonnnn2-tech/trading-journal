import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteFieldDefinition, updateFieldDefinition } from "@/lib/fields/definitions";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const updated = await updateFieldDefinition(supabase, id, {
    label: body.label,
    field_type: body.field_type,
    options: body.options,
    sort_order: body.sort_order,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await deleteFieldDefinition(supabase, id);
  return NextResponse.json({ ok: true });
}
