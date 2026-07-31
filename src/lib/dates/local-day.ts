// Timezone-aware day boundaries.
//
// The dashboard's "Today's P/L" and monthly calendar previously bucketed
// trades by UTC calendar day even though the user's IANA timezone is
// already captured (user_settings.timezone, used by insights/ask via
// getLocalDayName). For anyone west of UTC that misfiled every evening
// trade into "tomorrow" -- a trade closed 7pm EST is 00:00 UTC the next
// day -- so the headline number on the dashboard disagreed with the trade
// the user had just logged.
//
// Everything here falls back to UTC when the timezone hasn't been detected
// yet, matching getLocalDayName's behaviour.

// Milliseconds to add to a UTC instant to get the wall-clock reading in
// `timeZone` at that instant. Positive east of UTC.
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Some ICU versions render midnight as hour "24" under hour12:false.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - instant.getTime();
}

/** The calendar year/month/day showing on a clock in `timeZone` at `instant`. */
export function localDateParts(
  instant: Date,
  timezone: string | null,
): { year: number; month: number; day: number } {
  const tz = timezone ?? "UTC";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1, // 0-indexed, matches JS Date
    day: Number(parts.day),
  };
}

/**
 * The UTC instant at which the local calendar day `year-month-day` begins in
 * `timezone`, as an ISO string suitable for comparing against a timestamptz.
 */
export function startOfLocalDayIso(
  year: number,
  month: number, // 0-indexed
  day: number,
  timezone: string | null,
): string {
  const tz = timezone ?? "UTC";
  const naiveUtc = Date.UTC(year, month, day);
  // The offset has to be sampled *at* the target instant, but finding that
  // instant needs the offset -- so sample once with a rough guess, then
  // re-sample at the corrected instant. Two passes settle every real zone,
  // including the ±1h shift when the guess lands on the far side of a DST
  // transition from the true midnight.
  let instant = naiveUtc - tzOffsetMs(new Date(naiveUtc), tz);
  instant = naiveUtc - tzOffsetMs(new Date(instant), tz);
  return new Date(instant).toISOString();
}

/** Day-of-month (1-31) that `isoTimestamp` falls on in the user's timezone. */
export function getLocalDayOfMonth(isoTimestamp: string, timezone: string | null): number {
  return localDateParts(new Date(isoTimestamp), timezone).day;
}
