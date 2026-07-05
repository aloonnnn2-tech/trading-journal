import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteFolder } from "@/lib/folders/queries";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await deleteFolder(supabase, id);
  return NextResponse.json({ ok: true });
}
