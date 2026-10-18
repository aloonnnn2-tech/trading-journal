import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { createFieldDefinition, listFieldDefinitions } from "@/lib/fields/definitions";
import type { EntityType } from "@/lib/fields/types";
import { fieldDefinitionCreateSchema, fieldKeyFromLabel } from "@/lib/fields/definition-schema";
import { rowLimitResponse } from "@/lib/limits";

export async function GET(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const url = new URL(request.url);
  const entityType = (url.searchParams.get("entityType") ?? "trade") as EntityType;
  const strategyId = url.searchParams.get("strategyId") ?? undefined;
  const fields = await listFieldDefinitions(supabase, entityType, strategyId);
  return NextResponse.json(fields);
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
  const parsed = fieldDefinitionCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid field" }, { status: 400 });
  }
  const body = parsed.data;
  const key = fieldKeyFromLabel(body.label);
  if (!key) {
    return NextResponse.json({ error: "Use at least one letter or number in the name." }, { status: 400 });
  }

  let field;
  try {
    field = await createFieldDefinition(supabase, userId, {
      entity_type: body.entity_type,
      key,
      label: body.label,
      field_type: body.field_type,
      options: body.options,
      sort_order: body.sort_order,
      strategy_id: body.strategy_id,
    });
  } catch (err) {
    const limited = rowLimitResponse(err);
    if (limited) return limited;
    throw err;
  }

  return NextResponse.json(field, { status: 201 });
}
