import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { setTradeFolders } from "@/lib/folders/queries";

const bodySchema = z.object({ folderIds: z.array(z.uuid()).max(200) }).strict();

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // A missing or non-array folderIds used to mean [] -- "remove every link" -- so a
  // malformed request silently emptied the trade's list.
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { folderIds: [ids] }" }, { status: 400 });
  }
  const { folderIds } = parsed.data;

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
