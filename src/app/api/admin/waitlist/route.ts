import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/tracking/admin-queries";
import { recordAudit } from "@/lib/admin/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { listWaitlist, removeWaitlistEntry } from "@/lib/waitlist/admin-queries";
import { waitlistToCsv } from "@/lib/waitlist/csv";

// The admin panel's Waitlist tab: GET downloads the list as CSV, DELETE
// removes one address (the privacy policy promises removal on request).
//
// The same authorization order as /api/admin/plan, and for the same reason:
// the caller's id comes from the auth header, the admin check runs against
// the caller's own RLS client, and only then is the service-role client --
// the one thing that can read this table -- constructed. Nothing in the
// request can widen that. These are visitors' email addresses; a non-admin
// who finds this URL gets a 403 and no data.

type Gate = { ok: true; userId: string; admin: ReturnType<typeof createAdminClient> } | { ok: false; response: Response };

async function gate(bucket: string): Promise<Gate> {
  const userId = await getUserIdFromHeader();
  if (!userId) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const limited = await enforceRateLimit(`${bucket}:${userId}`, 60, 60_000);
  if (limited) return { ok: false, response: limited };

  const supabase = await createClient();
  if (!(await isAdmin(supabase, userId))) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  try {
    return { ok: true, userId, admin: createAdminClient() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not configured (no service-role key)." }, { status: 501 }),
    };
  }
}

export async function GET() {
  const g = await gate("admin-waitlist-export");
  if (!g.ok) return g.response;

  const { entries } = await listWaitlist(g.admin);
  // Personal data leaving the app: who took it, and how many rows.
  await recordAudit({ actorId: g.userId, action: "waitlist_export", detail: { rows: entries.length } }, g.admin);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(waitlistToCsv(entries), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trading-lens-waitlist-${stamp}.csv"`,
      // Personal data: never let a proxy or the browser cache keep a copy.
      "Cache-Control": "no-store",
    },
  });
}

const removeSchema = z.object({ id: z.uuid() });

export async function DELETE(request: Request) {
  const g = await gate("admin-waitlist-remove");
  if (!g.ok) return g.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = removeSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const removed = await removeWaitlistEntry(g.admin, parsed.data.id);
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await recordAudit({ actorId: g.userId, action: "waitlist_remove", target: parsed.data.id }, g.admin);
  return NextResponse.json({ ok: true });
}
