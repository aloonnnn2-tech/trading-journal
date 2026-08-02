import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { setTimezoneIfUnset } from "@/lib/settings/queries";

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
  const timezone = body.timezone;
  if (typeof timezone !== "string" || timezone.length === 0 || timezone.length > 100) {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }

  await setTimezoneIfUnset(supabase, userId, timezone);
  return NextResponse.json({ ok: true });
}
