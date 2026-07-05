import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createFolder, listFolders } from "@/lib/folders/queries";

export async function GET() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const folders = await listFolders(supabase);
  return NextResponse.json(folders);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const folder = await createFolder(supabase, userData.user.id, name);
  return NextResponse.json(folder, { status: 201 });
}
