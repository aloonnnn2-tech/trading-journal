import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { setTimezoneIfUnset } from "@/lib/settings/queries";

// A real IANA zone, not just any short string: day-bucketing passes this to
// Intl and to Postgres `at time zone`, where an unknown name throws. Intl
// accepts exactly the names a browser reports, aliases included.
function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const bodySchema = z
  .object({ timezone: z.string().min(1).max(100).refine(isTimeZone, "Unknown time zone") })
  .strict();

export async function PATCH(request: Request) {
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
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }
  const { timezone } = parsed.data;

  await setTimezoneIfUnset(supabase, userId, timezone);
  return NextResponse.json({ ok: true });
}
