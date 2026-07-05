import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "trade-images";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const { id: tradeId, imageId } = await params;
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: image, error: fetchError } = await supabase
    .from("trade_images")
    .select("id, user_id, trade_id, storage_path")
    .eq("id", imageId)
    .eq("trade_id", tradeId)
    .single();

  if (fetchError || !image) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (image.user_id !== userData.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error: removeError } = await supabase.storage.from(BUCKET).remove([image.storage_path]);
  if (removeError) {
    return NextResponse.json({ error: removeError.message }, { status: 500 });
  }

  const { error: deleteError } = await supabase
    .from("trade_images")
    .delete()
    .eq("id", imageId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
