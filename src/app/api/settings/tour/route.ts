import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserSettings, setTourCompleted } from "@/lib/settings/queries";

export async function GET() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getUserSettings(supabase, userData.user.id);
  return NextResponse.json({ hasCompletedTour: settings.has_completed_tour });
}

export async function PATCH() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await setTourCompleted(supabase, userData.user.id);
  return NextResponse.json({ ok: true });
}
