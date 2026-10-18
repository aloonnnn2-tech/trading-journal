import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { enforceDailyCap } from "@/lib/rate-limits/daily";
import { EXPORT_SECTIONS } from "@/lib/account/data-export";
import { log } from "@/lib/observability/log";
import { recordAudit } from "@/lib/admin/audit";
import { getAuthProfile } from "@/lib/account/auth-profile";

// "Download all my data" (security hardening, Part B). Everything stored
// about the signed-in account as one JSON file. See src/lib/account/
// data-export.ts for what is in it and why each excluded table is excluded.
//
// A FIXED path on purpose: this route uses the service-role client (for the
// analytics tables only, filtered by the header user id), and no
// service-role route may live under a dynamic segment (see SECURITY.md).
//
// Streamed section by section: a large journal with full edit history can
// pass Netlify's 6 MB limit for a buffered function response.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await enforceRateLimit(
    `account-export:${userId}`,
    5,
    60 * 60_000,
    "You've downloaded your data a few times already. Try again in an hour.",
  );
  if (limited) return limited;
  const daily = await enforceDailyCap("export", userId);
  if (daily) return daily;

  const db = await createClient();
  let admin = null;
  try {
    admin = createAdminClient();
  } catch {
    // No service-role key configured: the export still works, without the
    // usage-event sections, and says so below.
  }
  const ctx = { db, admin, userId };
  // A full copy of an account's data leaving the app is worth a line in the
  // audit trail: who and when, nothing of the contents.
  await recordAudit({ actorId: userId, action: "account_export", target: userId });
  // The sign-in record (email, dates, sign-in methods): not in any table the
  // sections read, so it was missing from "everything we store".
  const account = await getAuthProfile(admin, userId);
  const encoder = new TextEncoder();
  const exportedAt = new Date().toISOString();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        write(
          `{"exported_at":${JSON.stringify(exportedAt)},"user_id":${JSON.stringify(userId)},` +
            `"account":${JSON.stringify(account)},` +
            `"note":${JSON.stringify(
              "Everything Trading Lens stores about this account. Screenshot links expire after one hour." +
                (admin ? "" : " Usage events could not be included on this server.") +
                (account ? "" : " The sign-in record (account) could not be read; ask support for it."),
            )},"sections":{`,
        );
        let first = true;
        for (const section of EXPORT_SECTIONS) {
          const rows = await section.rows(ctx);
          write(`${first ? "" : ","}${JSON.stringify(section.name)}:${JSON.stringify(rows)}`);
          first = false;
        }
        write("}}");
        controller.close();
      } catch (error) {
        // Headers are already sent, so the honest failure is a truncated
        // file that does not parse -- never a file that looks complete.
        log.error("account.export_failed", { userId, error });
        controller.error(error);
      }
    },
  });

  const day = exportedAt.slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="trading-lens-data-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
