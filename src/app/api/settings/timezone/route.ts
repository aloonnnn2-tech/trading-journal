import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setTimezoneIfUnset } from "@/lib/settings/queries";

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const timezone = body.timezone;
  if (typeof timezone !== "string" || timezone.length === 0 || timezone.length > 100) {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }

  await setTimezoneIfUnset(supabase, userData.user.id, timezone);
  return NextResponse.json({ ok: true });
}
