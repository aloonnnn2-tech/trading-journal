import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteFieldDefinition, updateFieldDefinition } from "@/lib/fields/definitions";
import { FIELD_TYPES } from "@/lib/fields/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  if (body.field_type !== undefined && !FIELD_TYPES.includes(body.field_type)) {
    return NextResponse.json({ error: "Invalid field_type" }, { status: 400 });
  }

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

  const deleted = await deleteFieldDefinition(supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
