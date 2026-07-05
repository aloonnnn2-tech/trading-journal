import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setCoreFieldHidden } from "@/lib/settings/queries";
import { EDITABLE_CORE_FIELDS, type EditableCoreField } from "@/lib/trades/types";

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const field = body.field as EditableCoreField;
  const hidden = Boolean(body.hidden);

  if (!EDITABLE_CORE_FIELDS.includes(field)) {
    return NextResponse.json({ error: "Unknown field" }, { status: 400 });
  }

  const settings = await setCoreFieldHidden(supabase, userData.user.id, field, hidden);
  return NextResponse.json(settings);
}
