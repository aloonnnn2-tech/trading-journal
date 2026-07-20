import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createFieldDefinition, listFieldDefinitions } from "@/lib/fields/definitions";
import { ENTITY_TYPES, FIELD_TYPES, type EntityType } from "@/lib/fields/types";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const entityType = (url.searchParams.get("entityType") ?? "trade") as EntityType;
  const strategyId = url.searchParams.get("strategyId") ?? undefined;
  const fields = await listFieldDefinitions(supabase, entityType, strategyId);
  return NextResponse.json(fields);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const key = String(body.label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!key || !body.label || !body.field_type) {
    return NextResponse.json({ error: "label and field_type are required" }, { status: 400 });
  }
  if (!FIELD_TYPES.includes(body.field_type)) {
    return NextResponse.json({ error: "Invalid field_type" }, { status: 400 });
  }
  if (body.entity_type !== undefined && !ENTITY_TYPES.includes(body.entity_type)) {
    return NextResponse.json({ error: "Invalid entity_type" }, { status: 400 });
  }

  const field = await createFieldDefinition(supabase, userData.user.id, {
    entity_type: body.entity_type ?? "trade",
    key,
    label: body.label,
    field_type: body.field_type,
    options: body.options ?? {},
    sort_order: body.sort_order ?? 200,
    strategy_id: body.strategy_id ?? null,
  });

  return NextResponse.json(field, { status: 201 });
}
