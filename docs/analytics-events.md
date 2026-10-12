# Analytics events: how to add one

Every analytics event is listed in **`src/lib/tracking/events.ts`**. That one
file is what the browser tracker, the `/api/analytics/track` route and the
admin Activity tab all read, so an event that isn't listed can't be sent,
stored or shown.

## Adding an event (3 steps)

1. **Add it to the list.** In `src/lib/tracking/events.ts`, add an entry to
   `CLIENT_EVENTS` (sent by the browser) or `SERVER_EVENTS` (logged by an API
   route). Give it:
   - a `category`;
   - a `countLabel` (plural, for count tables: "Trades created");
   - a `props` zod schema with paths, ids, enums and counts only, never typed
     text or trade values;
   - a `sentence`, the line the admin feed shows. Put the important words in
     `**bold**`.

2. **Add a sample** of it to `SAMPLES` in `src/lib/tracking/events.test.ts`.
   The test fails until you do, and then proves the sentence renders.

3. **Send it.**
   - Browser: `track("your_event", { ... })` from `useAnalytics()`, or
     `<TrackPageView event="..." />` for a `*_viewed` event.
   - Server: `void logEvent(supabase, userId, SERVER_SESSION_ID, "your_event", { ... })`.

   Both are typed to the list, so a misspelled or unlisted name doesn't
   compile.

## Clickable elements

Clicks are recorded automatically, labelled by `data-track`, `aria-label`,
`id`, `data-tour-id` or visible text (see `deriveLabel` in
`src/lib/tracking/click-capture.ts`).

- A label that is words ("Save fee") shows as written.
- A developer id (`ask-submit`) needs a name in `CLICK_LABELS` in
  `events.ts`. `events.test.ts` fails if any literal `data-tour-id` or
  `data-track` in the source has no name.
- Wrap anything that displays user data in `data-track-private`, so its text
  never becomes a label.

## What happens to bad events

The track route refuses an unknown name or a props shape that doesn't match
the schema (400), keeps the good events from a batch, and logs the count of
refusals with `[analytics] rejected events`. In the admin screens, a stored
row nobody can name shows as "Unknown event (raw: ...)" with an "unmapped"
badge and is counted in the header. It is never shown as a blank row.

## Where they left

The browser sends `page_exit { path }` whenever the tab is hidden (closed,
switched away from, or backgrounded on a phone), using `navigator.sendBeacon`.
A session's last `page_exit` is where it ended. If none arrived and the
session has been quiet for 30 minutes, the last page is shown, marked
**inferred** (`src/lib/tracking/activity.ts`).
