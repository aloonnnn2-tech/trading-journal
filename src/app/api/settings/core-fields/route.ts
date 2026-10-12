import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { setCoreFieldHidden } from "@/lib/settings/queries";
import { EDITABLE_CORE_FIELDS } from "@/lib/trades/types";

// `hidden` used to be coerced with Boolean(), so the string "false" hid the field.
const bodySchema = z.object({ field: z.enum(EDITABLE_CORE_FIELDS), hidden: z.boolean() }).strict();

export async function PATCH(request: Request) {
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
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { field, hidden }" }, { status: 400 });
  }
  const { field, hidden } = parsed.data;

  const settings = await setCoreFieldHidden(supabase, userId, field, hidden);
  return NextResponse.json(settings);
}
