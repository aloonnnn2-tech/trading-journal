import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/tracking/log";

// Keep props small and structured -- per the analytics brief, this table
// should never hold free-text trade notes or anything beyond minimal
// metadata like a path or an id.
const bodySchema = z.object({
  eventName: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(128),
  props: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { eventName, sessionId, props } = parsed.data;
  await logEvent(supabase, userData.user.id, sessionId, eventName, props);

  return NextResponse.json({ ok: true });
}
