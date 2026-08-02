import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { setCoreFieldHidden } from "@/lib/settings/queries";
import { EDITABLE_CORE_FIELDS, type EditableCoreField } from "@/lib/trades/types";

export async function PATCH(request: Request) {
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
  const field = body.field as EditableCoreField;
  const hidden = Boolean(body.hidden);

  if (!EDITABLE_CORE_FIELDS.includes(field)) {
    return NextResponse.json({ error: "Unknown field" }, { status: 400 });
  }

  const settings = await setCoreFieldHidden(supabase, userId, field, hidden);
  return NextResponse.json(settings);
}
