// Sunday-first display order for day-of-week chart axes.
export const WEEKDAY_ORDER = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Buckets a timestamptz into the trader's local day of week, so a trade
// closed late at night isn't attributed to the wrong day. Falls back to UTC
// when the user's timezone hasn't been detected/stored yet
// (see src/lib/settings/queries.ts:setTimezoneIfUnset).
export function getLocalDayName(isoTimestamp: string, timezone: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone ?? "UTC",
    weekday: "long",
  }).format(new Date(isoTimestamp));
}
