import type { EquityPoint } from "@/lib/equity/build";

// Drawdown as EPISODES rather than as one number.
//
// A single "max drawdown" says how bad it got once. What a trader actually
// needs to know is how often it happens, how deep it usually goes, how long it
// takes to climb back, and whether the one they are in now is normal or not.
//
// Built on the curve from lib/equity, which already measures drawdown on the
// TRADING line -- so a withdrawal never opens an episode and a deposit never
// closes one. That property is inherited rather than reimplemented.

/** An episode needs at least this many completed siblings before the app will
 *  describe one as unusually deep or long. Below that "your deepest ever" is
 *  true but says nothing, because there is barely anything to be deepest of. */
export const MIN_EPISODES_TO_COMPARE = 5;

export interface DrawdownEpisode {
  /** The day the curve first fell below its peak. */
  startDate: string;
  /** The day it reached its worst point. */
  troughDate: string;
  /** The day it regained the old peak. Null while still running. */
  recoveredDate: string | null;
  /** Depth at the trough, as a negative number. */
  depth: number;
  /** The same as a share of the account at the peak. Null when no capital was
   *  recorded then. */
  depthPercent: number | null;
  /** Calendar days from the fall to the recovery, or to the last trade while
   *  still open. */
  days: number;
  /** Trades taken between the peak and the recovery. */
  trades: number;
  /** Trades taken from the trough back to the old peak. Null while open --
   *  the climb has not finished, and reporting a count would imply it had. */
  tradesToRecover: number | null;
  /** R given back between peak and trough, and R regained on the way out.
   *  Null when the trades involved recorded no R multiple. */
  rLost: number | null;
  rRecovered: number | null;
  /** False while the curve is still below the old peak. */
  recovered: boolean;
}

export interface DrawdownReport {
  episodes: DrawdownEpisode[];
  /** Completed episodes only. The open one is excluded from every average --
   *  its recovery has not happened, and folding it in would bias every
   *  recovery figure toward whatever today happens to be. */
  completed: DrawdownEpisode[];
  /** The episode still running, if any. */
  current: DrawdownEpisode | null;
  deepest: DrawdownEpisode | null;
  longest: DrawdownEpisode | null;
  medianDepth: number | null;
  medianDays: number | null;
  medianTradesToRecover: number | null;
  /** True when the open episode is deeper than every completed one -- the
   *  fact a trader most needs and is least likely to notice. */
  currentIsDeepest: boolean;
  /** Whether there are enough completed episodes to call anything unusual. */
  comparable: boolean;
}

/** The episode being accumulated. Named rather than inline because the value
 *  is assigned inside a callback, which TypeScript's control-flow analysis
 *  cannot follow -- after the loop it narrows the variable to `never` unless
 *  the type is stated explicitly. */
interface OpenEpisode {
  startDate: string;
  troughDate: string;
  depth: number;
  depthPercent: number | null;
  startIndex: number;
  troughIndex: number;
  rAtPeak: number;
  rAtTrough: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 86_400_000) : 0;
}

/**
 * Walks the curve and cuts it into episodes.
 *
 * An episode opens the first time the curve sits below its running peak and
 * closes when it regains that peak exactly -- not when it merely stops
 * falling. A trough is the low-water mark inside one, which is why the trough
 * and the recovery are tracked separately: "how far down" and "how long back"
 * are different questions and traders ask both.
 *
 * Cash movements in the curve are skipped: they change the balance but not the
 * trading line, so they can neither open nor close an episode.
 */
export function buildDrawdownReport(points: EquityPoint[]): DrawdownReport {
  const episodes: DrawdownEpisode[] = [];

  let open: OpenEpisode | null = null;

  points.forEach((point, index) => {
    if (point.drawdown < 0) {
      if (!open) {
        open = {
          startDate: point.date,
          troughDate: point.date,
          depth: point.drawdown,
          depthPercent: point.drawdownPercent,
          startIndex: index,
          troughIndex: index,
          // R as it stood at the peak -- the point before this one, since this
          // is already the first point below it.
          rAtPeak: index > 0 ? points[index - 1].cumulativeR : point.cumulativeR,
          rAtTrough: point.cumulativeR,
        };
      }
      if (point.drawdown < open.depth) {
        open.depth = point.drawdown;
        open.depthPercent = point.drawdownPercent;
        open.troughDate = point.date;
        open.troughIndex = index;
        open.rAtTrough = point.cumulativeR;
      }
      return;
    }

    // Back to the peak: the episode is over.
    if (open) {
      episodes.push({
        startDate: open.startDate,
        troughDate: open.troughDate,
        recoveredDate: point.date,
        depth: open.depth,
        depthPercent: open.depthPercent,
        days: daysBetween(open.startDate, point.date),
        trades: index - open.startIndex,
        tradesToRecover: index - open.troughIndex,
        rLost: open.rAtTrough - open.rAtPeak,
        rRecovered: point.cumulativeR - open.rAtTrough,
        recovered: true,
      });
      open = null;
    }
  });

  // Whatever is still running at the end of the journal.
  const last = points[points.length - 1];
  const stillOpen = open as OpenEpisode | null;
  const current: DrawdownEpisode | null =
    stillOpen && last
      ? {
          startDate: stillOpen.startDate,
          troughDate: stillOpen.troughDate,
          recoveredDate: null,
          depth: stillOpen.depth,
          depthPercent: stillOpen.depthPercent,
          days: daysBetween(stillOpen.startDate, last.date),
          trades: points.length - stillOpen.startIndex,
          // Null, not zero: the climb has not finished, and a number here
          // would read as "it took this many" rather than "it is still going".
          tradesToRecover: null,
          rLost: stillOpen.rAtTrough - stillOpen.rAtPeak,
          rRecovered: null,
          recovered: false,
        }
      : null;

  const completed = episodes;
  const all = current ? [...completed, current] : completed;

  const deepest =
    all.length > 0 ? all.reduce((worst, e) => (e.depth < worst.depth ? e : worst)) : null;
  const longest =
    all.length > 0 ? all.reduce((longestSoFar, e) => (e.days > longestSoFar.days ? e : longestSoFar)) : null;

  return {
    episodes: all,
    completed,
    current,
    deepest,
    longest,
    // Averages cover COMPLETED episodes only -- see the note on `completed`.
    medianDepth: median(completed.map((e) => e.depth)),
    medianDays: median(completed.map((e) => e.days)),
    medianTradesToRecover: median(
      completed
        .map((e) => e.tradesToRecover)
        .filter((v): v is number => v !== null),
    ),
    currentIsDeepest:
      current !== null && completed.every((e) => current.depth < e.depth) && completed.length > 0,
    comparable: completed.length >= MIN_EPISODES_TO_COMPARE,
  };
}
