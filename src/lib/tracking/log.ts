import type { SupabaseClient } from "@supabase/supabase-js";

const HEARTBEAT_INCREMENT_SECONDS = 30;

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
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  eventName: string,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from("analytics_events").insert({
      user_id: userId,
      session_id: sessionId,
      event_name: eventName,
      event_props: props,
    });
  } catch {
    // Best-effort -- analytics must never break the feature it's attached to.
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
    const { data: existing } = await supabase
      .from("analytics_sessions")
      .select("duration_seconds")
      .eq("id", sessionId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("analytics_sessions")
        .update({
          last_seen_at: new Date().toISOString(),
          duration_seconds: (existing.duration_seconds ?? 0) + HEARTBEAT_INCREMENT_SECONDS,
        })
        .eq("id", sessionId);
    } else {
      await supabase.from("analytics_sessions").insert({
        id: sessionId,
        user_id: userId,
        duration_seconds: 0,
      });
    }
  } catch {
    // Best-effort -- same reasoning as logEvent.
  }
}
