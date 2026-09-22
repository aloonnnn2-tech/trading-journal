import { z } from "zod";
import { getLocalDayName, getLocalHour } from "@/lib/dates/day-of-week";

// The shared trade filter, row shape, and in-memory stats used by the
// journal tools. Moved from the original single-file tools.ts unchanged
// except where noted; nothing here touches the database.

export const MAX_ROWS_OUT = 50;
export const MAX_GROUPS_OUT = 40;
export const MAX_TXNS_OUT = 100;

// ---- shared filter -------------------------------------------------------

const isoDate = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}/, "dates must be YYYY-MM-DD");

export const filterSchema = z
  .object({
    ticker: z.string().max(40).optional(),
    direction: z.enum(["long", "short"]).optional(),
    status: z.enum(["pending", "open", "closed", "expired"]).optional(),
    result: z.enum(["open", "win", "loss", "break_even"]).optional(),
    mode: z.enum(["trade", "investment"]).optional(),
    strategy: z.string().max(120).optional(),
    folder: z.string().max(120).optional(),
    market: z.string().max(60).optional(),
    // A date, or a timestamp whose first ten characters are one. Anything
    // else used to compare as a string against "YYYY-MM-DD" and silently
    // match nothing; now the model is told the shape it must send.
    date_from: isoDate.optional(),
    date_to: isoDate.optional(),
    pl_min: z.number().optional(),
    pl_max: z.number().optional(),
    r_min: z.number().optional(),
    r_max: z.number().optional(),
    risk_max: z.number().optional(),
    custom_field: z.object({ key: z.string().max(120), value: z.string().max(200) }).optional(),
  })
  .strict()
  .optional();

export type Filter = z.infer<typeof filterSchema>;

/**
 * One trade as the tools see it. Selected with an explicit column list (see
 * store.ts) -- never `*` -- so housekeeping columns (`user_id`,
 * `dismissed_suggestions`, `commission_manual`) never enter a tool result.
 */
export interface Row {
  [k: string]: unknown;
  id: string;
  mode: string;
  status: string;
  result: string;
  ticker: string | null;
  company_name: string | null;
  asset_type: string | null;
  market: string | null;
  direction: string | null;
  order_type: string | null;
  entry_date: string | null;
  exit_date: string | null;
  entry_price: number | null;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  shares: number | null;
  position_size: number | null;
  dollar_amount: number | null;
  risk_amount: number | null;
  risk_percent: number | null;
  dollar_pl: number | null;
  percent_return: number | null;
  r_multiple: number | null;
  risk_reward_ratio: number | null;
  commission: number | null;
  custom_fields: Record<string, unknown> | null;
  strategy_field_values: Record<string, Record<string, unknown>> | null;
  updated_at: string | null;
  trade_strategies?: { strategies: { id?: string; name: string } | { id?: string; name: string }[] | null }[];
}

/** The columns the store selects. Kept beside Row so the two stay aligned. */
// One literal, not a concatenation: supabase-js infers the row type from the
// select string's LITERAL type, and `a + b` widens to plain `string`, which
// it cannot parse.
export const ROW_COLUMNS =
  "id, mode, status, result, ticker, company_name, asset_type, market, direction, order_type, entry_date, exit_date, entry_price, exit_price, stop_loss, take_profit, shares, position_size, dollar_amount, risk_amount, risk_percent, dollar_pl, percent_return, r_multiple, risk_reward_ratio, commission, custom_fields, strategy_field_values, updated_at, trade_strategies(strategies(id, name))";

export function strategyNames(t: Row): string[] {
  return (t.trade_strategies ?? [])
    .flatMap((l) => (Array.isArray(l.strategies) ? l.strategies : [l.strategies]))
    .map((s) => s?.name)
    .filter((n): n is string => typeof n === "string");
}

export function strategyIds(t: Row): string[] {
  return (t.trade_strategies ?? [])
    .flatMap((l) => (Array.isArray(l.strategies) ? l.strategies : [l.strategies]))
    .map((s) => s?.id)
    .filter((n): n is string => typeof n === "string");
}

export function dateOnly(v: unknown): string | null {
  return typeof v === "string" ? v.slice(0, 10) : null;
}

export function matchesFilter(t: Row, f: Filter, folderIdsByTrade?: Record<string, string[]>, folderNameToId?: Map<string, string>): boolean {
  if (!f) return true;
  if (f.ticker && (t.ticker ?? "").toUpperCase() !== f.ticker.toUpperCase()) return false;
  if (f.direction && t.direction !== f.direction) return false;
  if (f.status && t.status !== f.status) return false;
  if (f.result && t.result !== f.result) return false;
  if (f.mode && t.mode !== f.mode) return false;
  if (f.market && (t.market ?? "").toLowerCase() !== f.market.toLowerCase()) return false;
  if (f.strategy) {
    const names = strategyNames(t).map((n) => n.toLowerCase());
    if (!names.includes(f.strategy.toLowerCase())) return false;
  }
  if (f.folder) {
    const id = folderNameToId?.get(f.folder.toLowerCase());
    if (!id || !(folderIdsByTrade?.[t.id] ?? []).includes(id)) return false;
  }
  const ref = dateOnly(t.exit_date) ?? dateOnly(t.entry_date);
  if (f.date_from && (!ref || ref < f.date_from.slice(0, 10))) return false;
  if (f.date_to && (!ref || ref > f.date_to.slice(0, 10))) return false;
  if (f.pl_min != null && !(typeof t.dollar_pl === "number" && t.dollar_pl >= f.pl_min)) return false;
  if (f.pl_max != null && !(typeof t.dollar_pl === "number" && t.dollar_pl <= f.pl_max)) return false;
  if (f.r_min != null && !(typeof t.r_multiple === "number" && t.r_multiple >= f.r_min)) return false;
  if (f.r_max != null && !(typeof t.r_multiple === "number" && t.r_multiple <= f.r_max)) return false;
  if (f.risk_max != null && !(typeof t.risk_percent === "number" && t.risk_percent <= f.risk_max)) return false;
  if (f.custom_field) {
    const raw = (t.custom_fields ?? {})[f.custom_field.key];
    const hay = Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
    if (!hay.some((v) => v.toLowerCase().includes(f.custom_field!.value.toLowerCase()))) return false;
  }
  return true;
}

// ---- grouping / stats ----------------------------------------------------

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function round(n: number | null | undefined, d = 2): number | null {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export interface StatBlock {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPL: number;
  avgPL: number | null;
  medianPL: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  avgR: number | null;
  profitFactor: number | null;
}

export function computeBlock(rows: Row[]): StatBlock {
  const pls = rows.map((r) => (typeof r.dollar_pl === "number" ? r.dollar_pl : 0));
  const winPls = pls.filter((p) => p > 0);
  const lossPls = pls.filter((p) => p < 0);
  const grossWin = winPls.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(lossPls.reduce((a, b) => a + b, 0));
  const rs = rows.map((r) => r.r_multiple).filter((r): r is number => typeof r === "number");
  const total = pls.reduce((a, b) => a + b, 0);
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  return {
    trades: rows.length,
    wins: winPls.length,
    losses: lossPls.length,
    winRate: rows.length ? round(winPls.length / rows.length, 4) : null,
    totalPL: round(total) ?? 0,
    avgPL: rows.length ? round(total / rows.length) : null,
    medianPL: round(median(pls)),
    avgWin: winPls.length ? round(grossWin / winPls.length) : null,
    avgLoss: lossPls.length ? round(-grossLoss / lossPls.length) : null,
    largestWin: winPls.length ? round(Math.max(...winPls)) : null,
    largestLoss: lossPls.length ? round(Math.min(...lossPls)) : null,
    avgR: round(avgR, 3),
    // Undefined profit factor (no losing trades) is reported as null rather
    // than Infinity, which serialises to null in JSON anyway and reads wrong.
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 3) : null,
  };
}

function holdBucket(t: Row): string {
  const a = dateOnly(t.entry_date);
  const b = dateOnly(t.exit_date);
  if (!a || !b) return "unknown";
  const days = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
  if (days <= 0) return "intraday";
  if (days === 1) return "1 day";
  if (days <= 5) return "2-5 days";
  if (days <= 20) return "1-4 weeks";
  return "over a month";
}

function riskBucket(t: Row): string {
  const r = t.risk_percent;
  if (typeof r !== "number") return "unrecorded";
  if (r < 0.5) return "under 0.5%";
  if (r < 1) return "0.5-1%";
  if (r < 2) return "1-2%";
  return "2%+";
}

function tagValues(t: Row, key: string): string[] {
  const e = (t.custom_fields ?? {})[key];
  const arr = Array.isArray(e) ? e.map(String) : e ? [String(e)] : [];
  return arr.length ? arr : ["(none)"];
}

export const GROUP_BY = [
  "none",
  "day_of_week",
  "month",
  "hour_of_day",
  "ticker",
  "market",
  "direction",
  "result",
  "strategy",
  "emotion_before",
  "emotion_during",
  "emotion_after",
  "mistake",
  "risk_bucket",
  "hold_bucket",
] as const;

export function groupKeys(t: Row, by: (typeof GROUP_BY)[number], tz: string | null): string[] {
  switch (by) {
    case "day_of_week":
      return t.exit_date ? [getLocalDayName(t.exit_date, tz)] : ["unknown"];
    case "month":
      return [dateOnly(t.exit_date ?? t.entry_date)?.slice(0, 7) ?? "unknown"];
    case "hour_of_day": {
      // A date-only entry (length 10) carries no time; bucketing it as
      // midnight would invent a pattern. Only real timestamps are bucketed,
      // and in the TRADER's zone rather than the server's.
      if (!t.entry_date || t.entry_date.length <= 10) return ["unknown"];
      return [`${String(getLocalHour(t.entry_date, tz)).padStart(2, "0")}:00`];
    }
    case "ticker":
      return [t.ticker ?? "unknown"];
    case "market":
      return [t.market ?? "unknown"];
    case "direction":
      return [t.direction ?? "unknown"];
    case "result":
      return [t.result ?? "unknown"];
    case "strategy": {
      const n = strategyNames(t);
      return n.length ? n : ["(none)"];
    }
    case "emotion_before":
      return tagValues(t, "emotion_before");
    case "emotion_during":
      return tagValues(t, "emotion_during");
    case "emotion_after":
      return tagValues(t, "emotion_after");
    case "mistake":
      return tagValues(t, "trade_mistakes");
    case "risk_bucket":
      return [riskBucket(t)];
    case "hold_bucket":
      return [holdBucket(t)];
    default:
      return ["all"];
  }
}
