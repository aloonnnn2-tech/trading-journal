import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/tracking/admin-queries";
import { recordAudit } from "@/lib/admin/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { HELP_STATUSES } from "@/lib/help/config";
import { deleteHelpRequest, setHelpStatus } from "@/lib/help/admin-queries";

// Answering help requests from /admin/help. A FIXED path with the id in the
// body, never /api/admin/help/[id]: this route uses the service role, and no
// service-role query may be keyed by an id from the URL (SECURITY.md §5).
// Same gate as /api/admin/waitlist: signed in, rate-limited, admin (checked
// on the RLS client before any service-role client exists), audited.

type Gate = { ok: true; userId: string; admin: ReturnType<typeof createAdminClient> } | { ok: false; response: Response };

async function gate(bucket: string): Promise<Gate> {
  const userId = await getUserIdFromHeader();
  if (!userId) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const limited = await enforceRateLimit(`${bucket}:${userId}`, 60, 60_000);
  if (limited) return { ok: false, response: limited };

  if (!(await isAdmin(await createClient(), userId))) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  try {
    return { ok: true, userId, admin: createAdminClient() };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Not configured (no service-role key)." }, { status: 501 }) };
  }
}

async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const updateSchema = z.object({ id: z.uuid(), status: z.enum(HELP_STATUSES) });

export async function PATCH(request: Request) {
  const g = await gate("admin-help-update");
  if (!g.ok) return g.response;

  const parsed = updateSchema.safeParse(await body(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const found = await setHelpStatus(g.admin, parsed.data.id, parsed.data.status);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await recordAudit(
    { actorId: g.userId, action: "help_update", target: parsed.data.id, detail: { status: parsed.data.status } },
    g.admin,
  );
  return NextResponse.json({ ok: true });
}

const removeSchema = z.object({ id: z.uuid() });

export async function DELETE(request: Request) {
  const g = await gate("admin-help-remove");
  if (!g.ok) return g.response;

  const parsed = removeSchema.safeParse(await body(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const removed = await deleteHelpRequest(g.admin, parsed.data.id);
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await recordAudit({ actorId: g.userId, action: "help_remove", target: parsed.data.id }, g.admin);
  return NextResponse.json({ ok: true });
}
