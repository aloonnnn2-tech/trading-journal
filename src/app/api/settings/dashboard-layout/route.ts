import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { setDashboardLayout } from "@/lib/settings/queries";
import { normalizeDashboardLayout } from "@/lib/dashboard/layout";

export async function PUT(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const body = await request.json();
  const layout = normalizeDashboardLayout(body);
  const saved = await setDashboardLayout(supabase, userId, layout);
  return NextResponse.json(saved);
}
