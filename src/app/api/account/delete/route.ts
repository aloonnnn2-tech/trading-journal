import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";

const IMAGE_BUCKET = "trade-images";

export async function DELETE() {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Irreversible and, on the failure paths, partially completed -- storage
  // objects are removed before the auth user is. Retrying in a loop after a
  // partial failure is exactly what should not happen, so this is the
  // tightest limit in the app.
  const limited = enforceRateLimit(
    `account-delete:${userId}`,
    5,
    60 * 60_000,
    "Too many deletion attempts. Wait an hour, or contact support if the account still exists.",
  );
  if (limited) return limited;

  const supabase = await createClient();

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
    console.error("[account] deleteUser failed:", deleteError);
    return NextResponse.json({ error: "Could not delete the account." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
