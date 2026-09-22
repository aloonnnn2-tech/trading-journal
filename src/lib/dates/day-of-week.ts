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

/**
 * The hour (0–23) of an instant in the given IANA zone.
 *
 * Exists because the AI tools' hour_of_day grouping used `getHours()`, which
 * is the SERVER's local hour -- UTC on Netlify -- so "which hour do I trade
 * best?" answered for London time regardless of where the trader is. Same
 * Intl approach as getLocalDayName above.
 */
export function getLocalHour(isoTimestamp: string, timezone: string | null): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone ?? "UTC",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(isoTimestamp));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  // Some ICU builds render midnight as "24" with hour12:false.
  return hour === 24 ? 0 : hour;
}
