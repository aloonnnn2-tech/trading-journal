import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { logEvent, logEvents } from "@/lib/tracking/log";
import { rateLimit } from "@/lib/rate-limit";
import { validateClientEvent, type ClientEventName } from "@/lib/tracking/events";

// Browser analytics events. Every event must be one of CLIENT_EVENTS in
// src/lib/tracking/events.ts and match that event's props schema. Unknown
// names and wrong shapes are refused and counted, so the table holds only
// events the admin screens can put into words. Server-only events
// (trade_created and so on) are not in that list, so a browser cannot forge
// them.
//
// The 2 KB cap stays as a backstop under the per-event schemas.
const MAX_PROPS_BYTES = 2048;
// Click autocapture sends batches. 25 is above what a 5-second window of
// human clicking produces, and low enough that one request stays small.
const MAX_BATCH = 25;

const propsSchema = z
  .record(z.string(), z.unknown())
  .refine((p) => JSON.stringify(p).length <= MAX_PROPS_BYTES, {
    message: `props must serialize to under ${MAX_PROPS_BYTES} bytes`,
  })
  .optional();

const eventSchema = z.object({
  eventName: z.string().min(1).max(64),
  props: propsSchema,
});

// Two accepted shapes: one event, and a batch.
const bodySchema = z.union([
  z.object({
    eventName: z.string().min(1).max(64),
    sessionId: z.string().min(1).max(128),
    props: propsSchema,
  }),
  z.object({
    sessionId: z.string().min(1).max(128),
    events: z.array(eventSchema).min(1).max(MAX_BATCH),
  }),
]);

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Generous: real usage is a handful of events per page view. This only
  // bites a client looping the endpoint to grow the table.
  const limit = await rateLimit(`track:${userId}`, 120, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many events" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { eventName, sessionId, props } or { sessionId, events }" }, { status: 400 });
  }
  const body = parsed.data;
  const incoming = "events" in body ? body.events : [{ eventName: body.eventName, props: body.props }];

  const accepted: { eventName: ClientEventName; props: Record<string, unknown> }[] = [];
  const rejected: Record<string, number> = {};
  for (const e of incoming) {
    const v = validateClientEvent(e.eventName, e.props);
    if (v.ok) accepted.push({ eventName: e.eventName as ClientEventName, props: v.props });
    else {
      const key = `${v.reason}:${e.eventName.slice(0, 64)}`;
      rejected[key] = (rejected[key] ?? 0) + 1;
    }
  }

  const rejectedCount = Object.values(rejected).reduce((a, b) => a + b, 0);
  if (rejectedCount > 0) {
    // Counts and event names only, never props: a reject is a client out of
    // step with events.ts (an old tab, a new event without a registry entry).
    console.warn("[analytics] rejected events", { count: rejectedCount, byReason: rejected });
  }
  if (accepted.length === 0) {
    return NextResponse.json({ error: "Unknown or malformed event", rejected: rejectedCount }, { status: 400 });
  }

  const supabase = await createClient();
  if (accepted.length === 1 && !("events" in body)) {
    await logEvent(supabase, userId, body.sessionId, accepted[0].eventName, accepted[0].props);
  } else {
    await logEvents(supabase, userId, body.sessionId, accepted);
  }

  return NextResponse.json({ ok: true, ...(rejectedCount ? { rejected: rejectedCount } : {}) });
}
