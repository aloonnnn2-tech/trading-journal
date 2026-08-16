import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { setTradeFolders } from "@/lib/folders/queries";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const folderIds = Array.isArray(body.folderIds) ? (body.folderIds as string[]) : [];

  try {
    await setTradeFolders(supabase, id, folderIds);
  } catch (error) {
    if (error instanceof Error && error.message === "Trade not found") {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "One or more folders were not found" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
