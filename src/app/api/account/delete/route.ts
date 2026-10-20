import { NextResponse } from "next/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/observability/log";
import { recordAudit } from "@/lib/admin/audit";
import { removeUserFiles, removeWaitlistEmail } from "@/lib/account/delete-account";
import { deletionProof, PROOF_MESSAGES } from "@/lib/account/deletion-proof";

export async function DELETE(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Irreversible and, on the failure paths, partially completed -- storage
  // objects are removed before the auth user is. Retrying in a loop after a
  // partial failure is exactly what should not happen, so this is the
  // tightest limit in the app.
  const limited = await enforceRateLimit(
    `account-delete:${userId}`,
    5,
    60 * 60_000,
    "Too many deletion attempts. Wait an hour, or contact support if the account still exists.",
  );
  if (limited) return limited;

  // First, so a server without the key changes nothing at all.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Account deletion isn't configured yet. Contact support." },
      { status: 501 },
    );
  }

  // Only from the emailed link (2026-10-20): the one-time code from that
  // link, for a request from this account that hasn't expired. A stolen
  // session or an injected script stops here -- the code is only in the
  // email. See src/lib/account/deletion-proof.ts.
  let token: unknown = null;
  try {
    token = ((await request.json()) as { token?: unknown } | null)?.token ?? null;
  } catch {
    token = null;
  }
  const proof = await deletionProof(admin, userId, token);
  if (!proof.ok) {
    return NextResponse.json({ error: PROOF_MESSAGES[proof.reason], reason: proof.reason }, { status: 403 });
  }

  // Table rows (trade_images included) cascade-delete with the auth user;
  // the files in Storage don't. Remove them first, and stop if that fails:
  // once the account is gone nothing in the app could find them again
  // (security gaps pass, 5.3 -- this used to ignore every error).
  let files: number;
  try {
    const { data: images, error } = await admin.from("trade_images").select("storage_path").eq("user_id", userId);
    if (error) throw error;
    files = await removeUserFiles(
      admin.storage,
      userId,
      (images ?? []).map((img) => img.storage_path as string),
    );
  } catch (error) {
    log.error("account.delete_files_failed", { error });
    return NextResponse.json(
      { error: "Couldn't delete your screenshots, so nothing was deleted. Try again in a minute." },
      { status: 500 },
    );
  }

  // The waitlist row is keyed by email, not user id, so it would outlive the
  // account. Best effort: it is one address, and failing the whole deletion
  // over it would keep everything else instead.
  let waitlistRemoved = false;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    if (data?.user?.email) waitlistRemoved = (await removeWaitlistEmail(admin, data.user.email)) > 0;
  } catch (error) {
    log.warn("account.delete_waitlist_failed", { error });
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    log.error("account.delete_failed", { error: deleteError });
    return NextResponse.json({ error: "Could not delete the account." }, { status: 500 });
  }

  // The id only (no email): enough to answer "was this account deleted, and
  // when", which is the question a deletion request comes back with.
  await recordAudit({ actorId: userId, action: "account_delete", target: userId, detail: { files, waitlist: waitlistRemoved } }, admin);

  return NextResponse.json({ ok: true });
}
