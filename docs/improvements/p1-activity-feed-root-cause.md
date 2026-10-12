# Problem 1: the admin activity feed is unreadable (root cause)

Written 2026-10-09, before any change. Every claim below was confirmed in
the code or measured read-only on the live database (6,685 events,
2026-07-07 to 2026-10-09).

## What Alon saw

- Rows like `tag: button · path: /trades · label: dashboard-quick-trade`.
- Some rows completely blank.
- No user or event type on a row.
- "Most clicked" shows ids like `nav-strategies`, `nav-group-ai` and
  `Close (Esc)`.

## Where it actually is

The feed and "Most clicked" are on **`/admin/users/[id]`** (one user's
page), not `/admin/analytics`. Rows come from the `admin_user_detail` RPC
(migration 0043), which returns the last 100 events with their raw
`event_props`. They are rendered by `src/app/admin/users/[id]/page.tsx`.

## Causes, confirmed

1. **No event types or templates; the UI prints raw keys.**
   - `describeProps` (`src/app/admin/users/[id]/page.tsx:57-65`) prints
     every non-empty `key: value` joined by " · ".
   - The key order is whatever Postgres jsonb stores: shortest key first,
     so `tag · path · label`.
   - Events are free-form: `track(eventName: string, props?: Record<string, unknown>)`
     in `src/lib/tracking/useAnalytics.ts`, and the server accepts any name
     of 1–64 characters and any props up to 2 KB (`api/analytics/track`).
2. **"Blank" rows are events that never carried props.** 2,089 of 6,685
   events (31%) have `{}`:

   | Event | Count |
   |---|---|
   | dashboard_viewed | 919 |
   | session_start | 692 |
   | analytics_panel_viewed | 258 |
   | login | 113 |
   | commissions_viewed | 79 |
   | settings_viewed | 18 |
   | signup_completed | 7 |
   | screenshot_parsed | 3 |

   The details cell has nothing to print, and nothing says what the event
   means.
3. **Click labels are developer ids, by design of the label rule.**
   - `deriveLabel` (`src/lib/tracking/click-capture.ts:60-102`) takes, in
     order: `data-track`, then `aria-label`, then `id`, then
     `data-tour-id`, then visible text.
   - The nav's `data-tour-id`s (`nav-trades`, `nav-group-ai`, built by
     `navLinkTourId` / `navGroupTourId` in `src/lib/nav/links.ts`) win for
     every nav click.
   - 123 distinct labels are recorded. They mix ids (`nav-trades`,
     `ask-submit`, `commissions-add`), aria-labels (`Close (Esc)`) and
     visible text (`Users`, `Save fee`, `Manage keys (2)`).
   - 28 clicks have no label at all.
   - `Close (Esc)` is the ✕ on the **trade side panel** on /trades
     (`src/app/trades/trade-panel.tsx:185`), not a form.
4. **No time zone, no user, no event type on a row.**
   - The time is formatted on the server, in the server's time zone.
   - It's a one-user page, so there's no user column, and nothing exists
     across users.
5. **"Where they left" is never captured.**
   - There is no exit event and no `sendBeacon`; `pagehide` only flushes
     the click buffer.
   - Server-side events (691) are stored with `session_id = "server"`, so
     they can't be joined to a browser session.
   - Sessions under 30 s leave a 0-second session row: 72 of 176 sessions,
     41%.

## What this means for the fix

The problem is upstream of the UI. With no schema, the data can't say what
an event is, so the screen can't either. The fix is a typed event registry
used by the tracker, the server and the admin UI. Old rows are rendered
through the same registry, so nothing is blank, and an unknown event shows
as "Unknown event" with its raw data and is counted.
