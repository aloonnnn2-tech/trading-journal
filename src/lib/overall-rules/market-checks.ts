import { movingAverage, movingAverageName, type MovingAverageType } from "@/lib/indicators/moving-average";
import { tradeMoment, zoneOffset, type Bar } from "@/lib/market-data/trade-window";
import { readPartialExits } from "@/lib/trades/partial-exits";
import type { Trade } from "@/lib/trades/types";
import type { CheckDetail, OverallRule, RuleCheck } from "./types";

// Moving-average rules against real daily prices. Pure: the caller fetches
// the bars (queries.ts) and passes them in, so every case is testable.
//
// Days are the exchange's own calendar days, both for the bars and for the
// trade's dates (tradeMoment: a date typed with no time means that day on
// the exchange). Averages are of daily closes, as a chart draws them.

/** One daily close on the exchange's calendar. */
export interface DailyClose {
  day: string; // YYYY-MM-DD, exchange time
  close: number;
}

export type MarketTrade = Pick<
  Trade,
  "direction" | "status" | "entry_price" | "exit_price" | "shares" | "entry_date" | "exit_date"
> & { partial_exits?: unknown };

/** The exchange's calendar day of a unix time. */
export function exchangeDay(time: number, timeZone: string): string {
  return new Date((time + zoneOffset(timeZone, time)) * 1000).toISOString().slice(0, 10);
}

/** Daily bars as exchange-day closes, oldest first, one per day. */
export function toDailyCloses(bars: Bar[], timeZone: string): DailyClose[] {
  const byDay = new Map<string, number>();
  for (const bar of bars) {
    if (!Number.isFinite(bar.close)) continue;
    byDay.set(exchangeDay(bar.time, timeZone), bar.close);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, close]) => ({ day, close }));
}

/** A trade date as an exchange calendar day. */
export function tradeDay(value: string | null | undefined, timeZone: string): string | null {
  const moment = tradeMoment(value, timeZone);
  return moment == null ? null : exchangeDay(moment, timeZone);
}

/** Calendar days of history a rule needs before the first trade it checks. */
export function lookbackDays(rule: Pick<OverallRule, "ma_period" | "ma_period_2" | "ma_type" | "ma_type_2">): number {
  const longest = Math.max(rule.ma_period ?? 0, rule.ma_period_2 ?? 0);
  // ~252 trading days a year, plus slack for holidays; an EMA wants extra
  // bars to settle.
  const emaExtra = rule.ma_type === "ema" || rule.ma_type_2 === "ema" ? 1.5 : 1;
  return Math.ceil(longest * emaExtra * 1.5) + 10;
}

interface Days {
  entryDay: string | null;
  exitDay: string | null;
}

function name(type: MovingAverageType | null, period: number | null): string {
  return movingAverageName(type ?? "sma", period ?? 0);
}

function fmtDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function fmt(n: number): string {
  return Math.abs(n) >= 100 ? n.toFixed(2) : Number(n.toPrecision(5)).toString();
}

function money(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}

const unevaluable = (rule: OverallRule, summary: string): RuleCheck => ({ rule, outcome: "unevaluable", detail: { summary } });

/**
 * "Exit once the daily close crosses the average": below it for a long,
 * above it for a short. The first such close while the trade was open (the
 * entry day through the exit day) is the trigger; the trade must be out
 * within `grace_days` trading days after it.
 */
export function checkMaExit(rule: OverallRule, closes: DailyClose[], trade: MarketTrade, days: Days): RuleCheck {
  if (trade.direction !== "long" && trade.direction !== "short") {
    return unevaluable(rule, "The trade has no direction, so which way to cross can't be known.");
  }
  const { entryDay, exitDay } = days;
  if (!entryDay) return unevaluable(rule, "The trade has no entry date.");
  const closed = trade.status === "closed";
  if (closed && !exitDay) return unevaluable(rule, "The trade has no exit date.");
  if (closed && exitDay === entryDay) {
    return unevaluable(rule, "Opened and closed the same day, so a daily-close rule doesn't apply.");
  }
  const maName = name(rule.ma_type, rule.ma_period);
  const ma = movingAverage(rule.ma_type ?? "sma", closes.map((c) => c.close), rule.ma_period ?? 0);

  const start = closes.findIndex((c) => c.day >= entryDay);
  if (start < 0) return unevaluable(rule, "No price data from the entry on.");
  let end = closes.length - 1;
  if (closed) {
    end = -1;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i].day <= exitDay!) {
        end = i;
        break;
      }
    }
    if (end < start) return unevaluable(rule, "No price data between the entry and the exit.");
  }
  if (ma[start] == null) {
    return unevaluable(rule, `Not enough price history before the entry to work out the ${maName}.`);
  }

  const long = trade.direction === "long";
  const side = long ? "below" : "above";
  let trigger = -1;
  for (let i = start; i <= end; i++) {
    const avg = ma[i];
    if (avg == null) continue;
    if (long ? closes[i].close < avg : closes[i].close > avg) {
      trigger = i;
      break;
    }
  }
  if (trigger < 0) {
    return {
      rule,
      outcome: "not_triggered",
      detail: {
        summary: closed
          ? `Never closed ${side} the ${maName} while the trade was open.`
          : `Hasn't closed ${side} the ${maName} since the entry.`,
        ...(closed ? {} : { still_open: true }),
      },
    };
  }

  const t = closes[trigger];
  const triggerMa = ma[trigger]!;
  const grace = Math.max(0, rule.grace_days);
  const deadlineIdx = trigger + grace;
  const base: CheckDetail = {
    summary: "",
    trigger_date: t.day,
    trigger_close: t.close,
    trigger_ma: round(triggerMa),
  };
  const triggerText = `Closed ${side} the ${maName} on ${fmtDate(t.day)} (${fmt(t.close)} vs ${fmt(triggerMa)})`;

  if (!closed) {
    if (deadlineIdx > closes.length - 1) {
      return {
        rule,
        outcome: "unevaluable",
        detail: {
          ...base,
          still_open: true,
          summary: `${triggerText}. The rule says to be out within ${plural(grace, "trading day")} of that close.`,
        },
      };
    }
    const deadline = closes[deadlineIdx];
    const last = closes[closes.length - 1];
    const daysLate = closes.length - 1 - deadlineIdx;
    const cost = costOfHolding(trade, deadline, last.close);
    return {
      rule,
      outcome: "broken",
      detail: {
        ...base,
        still_open: true,
        deadline_date: deadline.day,
        deadline_close: deadline.close,
        days_late: daysLate,
        ...(cost != null ? { cost: round(cost) } : {}),
        summary:
          `${triggerText}, and the trade is still open ${plural(daysLate, "trading day")} past the ${fmtDate(deadline.day)} deadline.` +
          (cost != null ? ` So far, holding on has ${cost >= 0 ? "cost" : "made"} ${money(Math.abs(cost))} vs selling then.` : ""),
      },
    };
  }

  const exitIdx = end;
  if (exitIdx <= deadlineIdx) {
    return {
      rule,
      outcome: "followed",
      detail: {
        ...base,
        summary: `${triggerText}, and you were out ${exitIdx === trigger ? "that day" : `${plural(exitIdx - trigger, "trading day")} later`}.`,
      },
    };
  }
  const deadline = closes[deadlineIdx];
  const daysLate = exitIdx - deadlineIdx;
  const cost = trade.exit_price != null ? costOfHolding(trade, deadline, trade.exit_price) : null;
  return {
    rule,
    outcome: "broken",
    detail: {
      ...base,
      deadline_date: deadline.day,
      deadline_close: deadline.close,
      days_late: daysLate,
      ...(cost != null ? { cost: round(cost) } : {}),
      summary:
        `${triggerText}. You exited ${exitDay ? fmtDate(exitDay) : "later"}, ${plural(daysLate, "trading day")} late.` +
        (cost != null
          ? cost >= 0
            ? ` Selling on time would have made ${money(cost)} more.`
            : ` Holding on made ${money(-cost)} more this time.`
          : ""),
    },
  };
}

/**
 * What selling everything still held at the deadline's close would have
 * made, minus what was actually made on those same shares (sales after the
 * deadline, then the rest at `finalPrice`). Positive = breaking the rule
 * cost money. Gross of fees; null without the sizes to work it out.
 */
export function costOfHolding(trade: MarketTrade, deadline: DailyClose, finalPrice: number): number | null {
  if (trade.shares == null || trade.entry_price == null) return null;
  const total = Math.abs(trade.shares);
  const sales = readPartialExits(trade.partial_exits);
  const soldBefore = sales.filter((s) => s.date.slice(0, 10) <= deadline.day).reduce((sum, s) => sum + s.shares, 0);
  const later = sales.filter((s) => s.date.slice(0, 10) > deadline.day);
  const held = total - soldBefore;
  if (held <= 0) return null;
  const laterShares = later.reduce((sum, s) => sum + s.shares, 0);
  const rest = held - laterShares;
  const followProceeds = held * deadline.close;
  const actualProceeds = later.reduce((sum, s) => sum + s.price * s.shares, 0) + rest * finalPrice;
  // A long gains by selling higher; a short by buying back lower.
  return trade.direction === "short" ? actualProceeds - followProceeds : followProceeds - actualProceeds;
}

/**
 * "Only enter with price above the average" (below, for a short), or "only
 * with one average above another" (below, for a short). Judged on the
 * averages as of the close BEFORE the entry day -- what was known when the
 * trade was taken.
 */
export function checkMaEntry(rule: OverallRule, closes: DailyClose[], trade: MarketTrade, days: Days): RuleCheck {
  if (trade.direction !== "long" && trade.direction !== "short") {
    return unevaluable(rule, "The trade has no direction.");
  }
  if (!days.entryDay) return unevaluable(rule, "The trade has no entry date.");
  const long = trade.direction === "long";
  let prev = -1;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i].day < days.entryDay) {
      prev = i;
      break;
    }
  }
  if (prev < 0) return unevaluable(rule, "No price data before the entry.");
  const values = closes.map((c) => c.close);
  const ma1 = movingAverage(rule.ma_type ?? "sma", values, rule.ma_period ?? 0)[prev];
  const name1 = name(rule.ma_type, rule.ma_period);
  if (ma1 == null) return unevaluable(rule, `Not enough price history before the entry to work out the ${name1}.`);
  const asOf = fmtDate(closes[prev].day);

  if (rule.entry_template === "ma_above_ma") {
    const ma2 = movingAverage(rule.ma_type_2 ?? "sma", values, rule.ma_period_2 ?? 0)[prev];
    const name2 = name(rule.ma_type_2, rule.ma_period_2);
    if (ma2 == null) return unevaluable(rule, `Not enough price history before the entry to work out the ${name2}.`);
    const ok = long ? ma1 > ma2 : ma1 < ma2;
    return {
      rule,
      outcome: ok ? "followed" : "broken",
      detail: {
        ma_value: round(ma1),
        ma_value_2: round(ma2),
        summary: `On ${asOf}, the day before entry, the ${name1} was ${fmt(ma1)} and the ${name2} ${fmt(ma2)}: ${name1} ${ma1 > ma2 ? "above" : "below"} ${name2}${ok ? "" : `, against the rule for a ${trade.direction}`}.`,
      },
    };
  }

  if (trade.entry_price == null) return unevaluable(rule, "The trade has no entry price.");
  const ok = long ? trade.entry_price > ma1 : trade.entry_price < ma1;
  return {
    rule,
    outcome: ok ? "followed" : "broken",
    detail: {
      entry_price: trade.entry_price,
      ma_value: round(ma1),
      summary: `Entered at ${fmt(trade.entry_price)}, ${trade.entry_price > ma1 ? "above" : "below"} the ${name1} (${fmt(ma1)} on ${asOf})${ok ? "" : `, against the rule for a ${trade.direction}`}.`,
    },
  };
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
