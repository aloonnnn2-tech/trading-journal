import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const IMAGE_BUCKET = "trade-images";

export async function DELETE() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = userData.user.id;

  // Best-effort: DB rows (trade_images included) cascade-delete with the
  // auth user, but the actual files in storage don't, so remove them
  // first while we still have the paths on hand.
  const { data: images } = await supabase
    .from("trade_images")
    .select("storage_path")
    .eq("user_id", userId);
  if (images && images.length > 0) {
    await supabase.storage.from(IMAGE_BUCKET).remove(images.map((img) => img.storage_path));
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Account deletion isn't configured yet. Contact support." },
      { status: 501 },
    );
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
