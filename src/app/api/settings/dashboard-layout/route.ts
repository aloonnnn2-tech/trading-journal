import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setDashboardLayout } from "@/lib/settings/queries";
import { normalizeDashboardLayout } from "@/lib/dashboard/layout";

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const layout = normalizeDashboardLayout(body);
  const saved = await setDashboardLayout(supabase, userData.user.id, layout);
  return NextResponse.json(saved);
}
