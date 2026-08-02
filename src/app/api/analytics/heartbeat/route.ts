import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { upsertHeartbeat } from "@/lib/tracking/log";
import { rateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  sessionId: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The client heartbeats on a fixed interval, so anything approaching this
  // is not the real UI.
  const limit = rateLimit(`heartbeat:${userId}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many heartbeats" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
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
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await upsertHeartbeat(supabase, userId, parsed.data.sessionId);

  return NextResponse.json({ ok: true });
}
