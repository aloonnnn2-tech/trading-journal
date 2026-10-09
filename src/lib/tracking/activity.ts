import type { SupabaseClient } from "@supabase/supabase-js";
import { categoryOf, clickName, describeEvent, pageName, type EventCategory } from "@/lib/tracking/events";
import { SERVER_SESSION_ID } from "@/lib/tracking/log";

/**
 * Turns raw analytics rows into what the admin Activity tab shows: a
 * readable feed, browser sessions with where each one ended, "where users
 * leave", and most-clicked by readable name. Pure (no I/O, `now` passed in)
 * so it is tested directly: src/lib/tracking/activity.test.ts.
 */

export interface ActivityRow {
  createdAt: string;
  userId: string | null;
  email: string | null;
  excluded: boolean;
  sessionId: string;
  eventName: string;
  props: Record<string, unknown>;
}

export interface FeedItem {
  at: string;
  userId: string | null;
  email: string | null;
  sentence: string;
  category: EventCategory | "unknown";
  page: string | null;
  unmapped: boolean;
  /** Raw name + props, for the "show raw" debug view. */
  raw: string;
}

export type ExitKind = "sent" | "inferred" | "active";

export interface Session {
  id: string;
  userId: string | null;
  email: string | null;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  /** Pages in the order visited, consecutive repeats collapsed. */
  pages: string[];
  exit: { kind: ExitKind; page: string | null };
}

export interface ExitStat {
  page: string;
  count: number;
  share: number;
  inferred: number;
}

export interface ClickStat {
  name: string;
  raw: string;
  count: number;
  page: string | null;
  mapped: boolean;
}

export interface Activity {
  feed: FeedItem[];
  sessions: Session[];
  exits: ExitStat[];
  clicks: ClickStat[];
  unmappedCount: number;
  eventCount: number;
}

/** A session idle this long without a page_exit counts as ended. */
export const IDLE_END_MS = 30 * 60 * 1000;

function ts(iso: string): number {
  return new Date(iso).getTime();
}

export function buildActivity(rows: ActivityRow[], now: Date, opts: { feedLimit?: number } = {}): Activity {
  const feedLimit = opts.feedLimit ?? 200;
  const newestFirst = [...rows].sort((a, b) => ts(b.createdAt) - ts(a.createdAt));

  const feed: FeedItem[] = [];
  let unmappedCount = 0;
  for (const r of newestFirst) {
    const d = describeEvent(r.eventName, r.props);
    if (d.unmapped) unmappedCount++;
    if (feed.length < feedLimit) {
      feed.push({
        at: r.createdAt,
        userId: r.userId,
        email: r.email,
        sentence: d.sentence,
        category: d.category,
        page: d.page,
        unmapped: d.unmapped,
        raw: JSON.stringify({ event: r.eventName, ...r.props }),
      });
    }
  }

  // ---- sessions (browser ones only; server events have no session)
  const bySession = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    if (!r.sessionId || r.sessionId === SERVER_SESSION_ID) continue;
    const list = bySession.get(r.sessionId);
    if (list) list.push(r);
    else bySession.set(r.sessionId, [r]);
  }

  const sessions: Session[] = [];
  for (const [id, list] of bySession) {
    list.sort((a, b) => ts(a.createdAt) - ts(b.createdAt));
    const first = list[0];
    const last = list[list.length - 1];

    const pages: string[] = [];
    for (const r of list) {
      if (r.eventName !== "page_view") continue;
      const name = pageName(r.props.path);
      if (pages[pages.length - 1] !== name) pages.push(name);
    }

    let exit: Session["exit"];
    const lastExit = [...list].reverse().find((r) => r.eventName === "page_exit");
    if (lastExit && lastExit === last) {
      exit = { kind: "sent", page: pageName(lastExit.props.path) };
    } else if (now.getTime() - ts(last.createdAt) >= IDLE_END_MS) {
      // No exit was delivered (crash, phone killed the app, or an older
      // tab) and the session has gone quiet: the last page with a path is
      // where they were. Marked inferred so it is never mistaken for a fact.
      const lastWithPath = [...list].reverse().find((r) => typeof r.props.path === "string");
      exit = { kind: "inferred", page: lastWithPath ? pageName(lastWithPath.props.path) : null };
    } else {
      exit = { kind: "active", page: null };
    }

    sessions.push({
      id,
      userId: first.userId,
      email: first.email,
      startedAt: first.createdAt,
      endedAt: last.createdAt,
      durationSeconds: Math.max(0, Math.round((ts(last.createdAt) - ts(first.createdAt)) / 1000)),
      pages,
      exit,
    });
  }
  sessions.sort((a, b) => ts(b.startedAt) - ts(a.startedAt));

  // ---- where users leave
  const exitCounts = new Map<string, { count: number; inferred: number }>();
  let ended = 0;
  for (const s of sessions) {
    if (s.exit.kind === "active" || !s.exit.page) continue;
    ended++;
    const c = exitCounts.get(s.exit.page) ?? { count: 0, inferred: 0 };
    c.count++;
    if (s.exit.kind === "inferred") c.inferred++;
    exitCounts.set(s.exit.page, c);
  }
  const exits: ExitStat[] = [...exitCounts]
    .map(([page, c]) => ({ page, count: c.count, inferred: c.inferred, share: ended ? c.count / ended : 0 }))
    .sort((a, b) => b.count - a.count);

  // ---- most clicked, by readable name
  const clickCounts = new Map<string, ClickStat>();
  for (const r of rows) {
    if (r.eventName !== "click") continue;
    const raw = typeof r.props.label === "string" ? r.props.label : "";
    const name = clickName(raw);
    const key = raw || "(unlabelled)";
    const existing = clickCounts.get(key);
    if (existing) existing.count++;
    else
      clickCounts.set(key, {
        name: name.sentence,
        raw: key,
        count: 1,
        page: typeof r.props.path === "string" ? pageName(r.props.path) : null,
        mapped: name.mapped,
      });
  }
  const clicks = [...clickCounts.values()].sort((a, b) => b.count - a.count);

  return { feed, sessions, exits, clicks, unmappedCount, eventCount: rows.length };
}

/** Filters the feed by category, keeping the "never blank" guarantee. */
export function filterFeed(feed: FeedItem[], category: string | null): FeedItem[] {
  if (!category) return feed;
  return feed.filter((f) => f.category === category);
}

export { categoryOf };

// ------------------------------------------------------------- query ---

export async function getActivityRows(
  supabase: SupabaseClient,
  opts: { days: number; userId?: string | null; limit?: number },
): Promise<ActivityRow[]> {
  const { data, error } = await supabase.rpc("admin_activity", {
    p_days: opts.days,
    p_user_id: opts.userId ?? null,
    p_limit: opts.limit ?? 5000,
  });
  if (error) throw error;
  return (data ?? []).map(
    (r: {
      created_at: string;
      user_id: string | null;
      email: string | null;
      excluded: boolean;
      session_id: string;
      event_name: string;
      event_props: Record<string, unknown> | null;
    }) => ({
      createdAt: r.created_at,
      userId: r.user_id,
      email: r.email,
      excluded: Boolean(r.excluded),
      sessionId: r.session_id,
      eventName: r.event_name,
      props: r.event_props ?? {},
    }),
  );
}
