import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventName } from "@/lib/tracking/events";
import { log } from "@/lib/observability/log";

// Events are written with the service-role client, never the user's own
// (migration 0066). While users could insert into analytics_events
// themselves, anyone signed in could skip /api/analytics/track -- and the
// event registry it enforces -- by writing to the table straight through
// Supabase with the key every browser holds, putting made-up activity in
// the admin feed. Now only this server code can write, and only after a
// route has authenticated the caller: `userId` always comes from the proxy's
// verified session (getUserIdFromHeader), never from a request body.

// Sentinel session_id for events logged from API route handlers rather than
// the browser tracker (trade CRUD, import) -- these fire from several
// different client call sites that all hit the same route, so logging once
// server-side guarantees coverage. None of the admin aggregate queries
// group by session_id, only analytics_sessions (updated by the real
// per-tab heartbeat) carries session-level time-on-site data.
export const SERVER_SESSION_ID = "server";

// Fire-and-forget event insert -- callers should never await this in a way
// that blocks the response (use `void logEvent(...)`). A logging failure
// must never fail the real mutation it's attached to.
export async function logEvent(
  userId: string,
  sessionId: string,
  // Only names listed in src/lib/tracking/events.ts compile.
  eventName: EventName,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    await createAdminClient().from("analytics_events").insert({
      user_id: userId,
      session_id: sessionId,
      event_name: eventName,
      event_props: props,
    });
  } catch {
    // Best-effort -- analytics must never break the feature it's attached to.
  }
}

// A batch in one insert -- what click autocapture sends. Same best-effort
// contract as logEvent: never let analytics fail the request it rode in on.
export async function logEvents(
  userId: string,
  sessionId: string,
  events: { eventName: EventName; props?: Record<string, unknown> }[],
): Promise<void> {
  if (events.length === 0) return;
  try {
    await createAdminClient().from("analytics_events").insert(
      events.map((e) => ({
        user_id: userId,
        session_id: sessionId,
        event_name: e.eventName,
        event_props: e.props ?? {},
      })),
    );
  } catch {
    // Best-effort -- same reasoning as logEvent.
  }
}

// Upserts the session's running time-on-site total. Called every ~30s by
// the client heartbeat while the tab is visible, so duration_seconds
// reflects actual active time rather than raw session open-to-close span.
export async function upsertHeartbeat(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<void> {
  try {
    // One atomic call, no read. The previous read-then-write could not work
    // for a non-admin: analytics_sessions has no select-own policy (0013, on
    // purpose), so the SELECT always came back empty, the INSERT branch always
    // ran, and every beat after the first died on the primary key -- silently,
    // because supabase-js returns that error rather than throwing.
    //
    // `userId` is no longer passed to the database: record_heartbeat (0045)
    // takes the owner from auth.uid() so a session can only ever be credited
    // to the caller. It stays in the signature because callers have it and it
    // keeps the shape consistent with logEvent.
    const { error } = await supabase.rpc("record_heartbeat", { p_session_id: sessionId });
    if (error) {
      // Best-effort, like logEvent -- a lost beat must never fail the request
      // that carried it. Logged rather than swallowed, because swallowing is
      // exactly what hid this bug for weeks.
      log.warn("analytics.heartbeat_failed", { error });
    }
  } catch (err) {
    log.warn("analytics.heartbeat_threw", { error: err });
  }
}
