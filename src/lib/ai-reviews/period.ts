import { localDateParts, startOfLocalDayIso } from "@/lib/dates/local-day";

// Resolving "this week" / "last month" into an exact window.
//
// **Everything here is calendar arithmetic on the TRADER'S local days**, then
// converted to UTC instants at the last moment. Doing it the other way round
// -- slicing ISO strings, or adding 7 * 86400000 to a timestamp -- is the bug
// this app has already fixed twice (see src/lib/dates/local-day.ts and the
// month-bucketing fix in analytics/queries.ts): for anyone west of UTC an
// evening trade lands in tomorrow's UTC day, so "last week" silently includes
// or excludes trades the trader would say belong to it. A weekly review is a
// statement about the trader's week, so it has to use the trader's days.
//
// The window is half-open once converted: [startIso, endIso). See the comment
// on AnalyticsRange for why an inclusive upper bound cannot be expressed
// correctly here.

export const PERIOD_KINDS = ["weekly", "monthly", "custom"] as const;

export type PeriodKind = (typeof PERIOD_KINDS)[number];

export interface ResolvedPeriod {
  kind: PeriodKind;
  /** First local calendar day covered, YYYY-MM-DD, inclusive. */
  startDate: string;
  /** Last local calendar day covered, YYYY-MM-DD, INCLUSIVE. */
  endDate: string;
  /** Inclusive lower bound as a UTC instant. */
  startIso: string;
  /** EXCLUSIVE upper bound as a UTC instant (midnight after endDate). */
  endIso: string;
  /** Human label, e.g. "26 Aug – 1 Sep 2026" or "August 2026". */
  label: string;
}

/** A local calendar date, month 0-indexed to match JS Date. */
interface Ymd {
  year: number;
  month: number;
  day: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

/**
 * Day arithmetic on the calendar itself.
 *
 * Date.UTC is used purely as a calendar calculator here -- these values are
 * never treated as instants, so there is no DST hazard in this function. The
 * DST-aware step is startOfLocalDayIso, which is where a calendar day becomes
 * a real moment.
 */
function addDays(date: Ymd, days: number): Ymd {
  const d = new Date(Date.UTC(date.year, date.month, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

function toDateString(date: Ymd): string {
  return `${date.year}-${String(date.month + 1).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

/** Parses YYYY-MM-DD. Returns null for anything that isn't a real date --
 *  including "2026-02-31", which Date would silently roll into March. */
export function parseDateString(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = { year: Number(y), month: Number(m) - 1, day: Number(d) };
  const roundTrip = new Date(Date.UTC(date.year, date.month, date.day));
  if (
    roundTrip.getUTCFullYear() !== date.year ||
    roundTrip.getUTCMonth() !== date.month ||
    roundTrip.getUTCDate() !== date.day
  ) {
    return null;
  }
  return date;
}

/** Days covered, inclusive of both ends. */
export function periodLengthDays(period: { startDate: string; endDate: string }): number {
  const start = parseDateString(period.startDate);
  const end = parseDateString(period.endDate);
  if (!start || !end) return 0;
  const ms =
    Date.UTC(end.year, end.month, end.day) - Date.UTC(start.year, start.month, start.day);
  return Math.round(ms / 86_400_000) + 1;
}

function label(kind: PeriodKind, start: Ymd, end: Ymd): string {
  // A whole calendar month reads better by name than as two dates, and that
  // is exactly what the monthly default always is.
  if (
    start.day === 1 &&
    start.year === end.year &&
    start.month === end.month &&
    end.day === new Date(Date.UTC(end.year, end.month + 1, 0)).getUTCDate()
  ) {
    return `${MONTH_NAMES[start.month]} ${start.year}`;
  }
  const startLabel = `${start.day} ${SHORT_MONTHS[start.month]}${
    start.year === end.year ? "" : ` ${start.year}`
  }`;
  return `${startLabel} – ${end.day} ${SHORT_MONTHS[end.month]} ${end.year}`;
}

function build(kind: PeriodKind, start: Ymd, end: Ymd, timezone: string | null): ResolvedPeriod {
  return {
    kind,
    startDate: toDateString(start),
    endDate: toDateString(end),
    startIso: startOfLocalDayIso(start.year, start.month, start.day, timezone),
    // Midnight at the START of the day after endDate: the exclusive bound
    // that makes endDate itself fully included.
    endIso: startOfLocalDayIso(end.year, end.month, end.day + 1, timezone),
    label: label(kind, start, end),
  };
}

/**
 * The default window for each kind, as the brief specifies:
 * weekly = the previous 7 days, monthly = the previous calendar month.
 *
 * Weekly counts back from today INCLUSIVE, so running it on a Sunday evening
 * covers Monday through Sunday -- the week the trader just finished, which is
 * the week they are asking about. Excluding today would silently drop the
 * session most likely to have prompted the review.
 *
 * Monthly is the previous calendar month rather than the current one, because
 * a review of a month still in progress is a review of a partial sample and
 * would change every time it was run.
 */
export function resolvePeriod(
  kind: PeriodKind,
  timezone: string | null,
  now: Date = new Date(),
  custom?: { startDate: string; endDate: string },
): ResolvedPeriod | null {
  const today = localDateParts(now, timezone);

  if (kind === "weekly") {
    return build("weekly", addDays(today, -6), today, timezone);
  }

  if (kind === "monthly") {
    const firstOfThisMonth: Ymd = { year: today.year, month: today.month, day: 1 };
    const lastOfPrevMonth = addDays(firstOfThisMonth, -1);
    const firstOfPrevMonth: Ymd = {
      year: lastOfPrevMonth.year,
      month: lastOfPrevMonth.month,
      day: 1,
    };
    return build("monthly", firstOfPrevMonth, lastOfPrevMonth, timezone);
  }

  if (!custom) return null;
  const start = parseDateString(custom.startDate);
  const end = parseDateString(custom.endDate);
  if (!start || !end) return null;
  if (Date.UTC(end.year, end.month, end.day) < Date.UTC(start.year, start.month, start.day)) {
    return null;
  }
  return build("custom", start, end, timezone);
}

/**
 * The equivalent window immediately before this one, for the period-over-
 * period comparison.
 *
 * A monthly period steps back a whole calendar month rather than a fixed
 * number of days: comparing a 31-day August against "the 31 days before it"
 * would straddle June and July and compare August against nothing anyone
 * recognises. Every other kind steps back by its own length, which is exactly
 * right for a 7-day week or an arbitrary custom range.
 */
export function previousPeriod(
  period: ResolvedPeriod,
  timezone: string | null,
): ResolvedPeriod | null {
  const start = parseDateString(period.startDate);
  if (!start) return null;

  if (period.kind === "monthly") {
    const lastOfPrev = addDays({ year: start.year, month: start.month, day: 1 }, -1);
    const firstOfPrev: Ymd = { year: lastOfPrev.year, month: lastOfPrev.month, day: 1 };
    return build("monthly", firstOfPrev, lastOfPrev, timezone);
  }

  const length = periodLengthDays(period);
  if (length <= 0) return null;
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(length - 1));
  return build(period.kind, prevStart, prevEnd, timezone);
}

/**
 * Resolves the window a request actually asked for.
 *
 * When both dates are supplied they are honoured for ANY kind, and `kind`
 * becomes a label describing how the window was chosen rather than a
 * shorthand for a window this function computes. That is what makes
 * regenerating an existing review possible: a weekly review of 19-25 August
 * has to be re-runnable in November, and re-resolving "weekly" would silently
 * review November instead -- a different period under the same heading, which
 * is the worst of both.
 *
 * It grants a caller nothing. `kind: "custom"` already accepts an arbitrary
 * range, so this relaxes no boundary; an impossible or backwards range is
 * still rejected below.
 *
 * With no dates -- the normal path when generating fresh -- weekly and
 * monthly compute their own window from the trader's timezone.
 */
export function resolveRequestedPeriod(
  kind: PeriodKind,
  timezone: string | null,
  now: Date,
  dates?: { startDate?: string; endDate?: string },
): ResolvedPeriod | null {
  const { startDate, endDate } = dates ?? {};
  if (startDate && endDate) {
    const explicit = resolvePeriod("custom", timezone, now, { startDate, endDate });
    return explicit ? { ...explicit, kind } : null;
  }
  return resolvePeriod(kind, timezone, now);
}
