import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { upsertHeartbeat } from "@/lib/tracking/log";

const bodySchema = z.object({
  sessionId: z.string().min(1).max(128),
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

  await upsertHeartbeat(supabase, userData.user.id, parsed.data.sessionId);

  return NextResponse.json({ ok: true });
}
