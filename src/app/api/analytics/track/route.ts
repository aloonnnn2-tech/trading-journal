import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { logEvent } from "@/lib/tracking/log";
import { rateLimit } from "@/lib/rate-limit";

// Keep props small and structured -- per the analytics brief, this table
// should never hold free-text trade notes or anything beyond minimal
// metadata like a path or an id.
// The 2 KB cap enforces what the comment above only asserted: eventName and
// sessionId were bounded but `props` was a wide-open jsonb sink, so any
// signed-in client could push arbitrarily large payloads into the table.
const MAX_PROPS_BYTES = 2048;

const bodySchema = z.object({
  eventName: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(128),
  props: z
    .record(z.string(), z.unknown())
    .refine((p) => JSON.stringify(p).length <= MAX_PROPS_BYTES, {
      message: `props must serialize to under ${MAX_PROPS_BYTES} bytes`,
    })
    .optional(),
});

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Generous: real usage is a handful of events per page view. This only
  // bites a client looping the endpoint to grow the table (see the props cap
  // above for the other half of that).
  const limit = rateLimit(`track:${userId}`, 120, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many events" },
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

  const { eventName, sessionId, props } = parsed.data;
  await logEvent(supabase, userId, sessionId, eventName, props);

  return NextResponse.json({ ok: true });
}
