import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setTradeFolders } from "@/lib/folders/queries";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const folderIds = Array.isArray(body.folderIds) ? (body.folderIds as string[]) : [];
  await setTradeFolders(supabase, id, folderIds);
  return NextResponse.json({ ok: true });
}
