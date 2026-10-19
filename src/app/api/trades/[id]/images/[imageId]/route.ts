import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { log } from "@/lib/observability/log";

const BUCKET = "trade-images";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const { id: tradeId, imageId } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: image, error: fetchError } = await supabase
    .from("trade_images")
    .select("id, user_id, trade_id, storage_path")
    .eq("id", imageId)
    .eq("trade_id", tradeId)
    .single();

  if (fetchError || !image) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (image.user_id !== userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error: removeError } = await supabase.storage.from(BUCKET).remove([image.storage_path]);
  if (removeError) {
    log.error("images.storage_remove_failed", { error: removeError });
    return NextResponse.json({ error: "Could not delete the image." }, { status: 500 });
  }

  const { error: deleteError } = await supabase
    .from("trade_images")
    .delete()
    .eq("id", imageId);

  if (deleteError) {
    log.error("images.row_delete_failed", { error: deleteError });
    return NextResponse.json({ error: "Could not delete the image." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
