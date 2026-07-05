import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCustomFieldsSchema } from "@/lib/fields/schema";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { deleteTrade, getTrade, updateTrade } from "@/lib/trades/queries";
import { EDITABLE_CORE_FIELDS, type EditableCoreField } from "@/lib/trades/types";

function pickEditableCore(input: unknown): Partial<Record<EditableCoreField, unknown>> {
  if (typeof input !== "object" || input === null) return {};
  const result: Partial<Record<EditableCoreField, unknown>> = {};
  for (const key of EDITABLE_CORE_FIELDS) {
    if (key in input) {
      result[key] = (input as Record<string, unknown>)[key];
    }
  }
  return result;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await getTrade(supabase, id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const core = pickEditableCore(body.core);

  let customFields: Record<string, unknown> | undefined;
  if (body.customFields) {
    const fieldDefinitions = await listFieldDefinitions(supabase, existing.mode);
    const schema = buildCustomFieldsSchema(fieldDefinitions);
    const parsed = schema.safeParse(body.customFields);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    customFields = parsed.data;
  }

  const updated = await updateTrade(supabase, id, { core, customFields });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await deleteTrade(supabase, id);
  return NextResponse.json({ ok: true });
}
