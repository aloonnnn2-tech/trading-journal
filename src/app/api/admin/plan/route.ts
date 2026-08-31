import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/tracking/admin-queries";
import { setUserPlan } from "@/lib/settings/admin-queries";
import { planUpdateSchema } from "@/lib/settings/schema";

// Sets another user's plan. This is the only route in the app that writes
// `plan`, and it is the reason `plan` is reachable at all: 0029 deliberately
// withholds the column grant that would let a user write their own, so the
// service-role client here is the sole writer besides the Supabase dashboard.
//
// The authorization order below is load-bearing. The admin check runs against
// the RLS-scoped client and the *caller's* id from the auth header -- never
// against anything in the request body -- before the service-role client is
// constructed. A body field naming the target user is only ever used to say
// whose row to change, after that.
export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  if (!(await isAdmin(supabase, userId))) {
    // 403, not 404: this route's existence isn't a secret, and an admin
    // debugging their own access should see "you aren't an admin" rather than
    // a misleading "no such route".
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = planUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid plan change" },
      { status: 400 },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Same shape as the account-deletion route: a missing service-role key is
    // a deployment gap, not a bad request.
    return NextResponse.json(
      { error: "Plan management isn't configured yet (no service-role key)." },
      { status: 501 },
    );
  }

  const updated = await setUserPlan(admin, parsed.data.userId, parsed.data.plan);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, plan: parsed.data.plan });
}
