import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { getUserSettings, setTourCompleted } from "@/lib/settings/queries";

export async function GET() {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const settings = await getUserSettings(supabase, userId);
  return NextResponse.json({ hasCompletedTour: settings.has_completed_tour });
}

export async function PATCH() {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  await setTourCompleted(supabase, userId);
  return NextResponse.json({ ok: true });
}
