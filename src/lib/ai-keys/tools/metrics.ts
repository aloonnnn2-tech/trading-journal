import { z } from "zod";
import { getAnalyticsSummary } from "@/lib/analytics/queries";
import { getDashboardStats } from "@/lib/dashboard/queries";
import { listTradesForStreak } from "@/lib/trades/queries";
import { computeAttentionStreak } from "@/lib/trades/streak";
import type { EditableCoreField } from "@/lib/trades/types";
import { METRIC_IDS, findMetric, type MetricEntry } from "../metrics/catalog";
import { getTrade, getTradeSchema, type ToolContext } from "./journal";
import { getReport } from "./reports";

// explain_metric: what a figure means in Trading Lens, how to judge it, and
// this trader's own value -- in ONE call, because a free key gets three
// lookups per question and "what's my MAE and is it good?" should not spend
// two of them (Alon, 2026-10-17).
//
// The meaning comes from the catalog (../metrics/catalog.ts). The value is
// always computed by the same function the page that shows it uses, so the
// answer can never quote a different number from the screen.

export const explainMetricSchema = z
  .object({
    metric: z.string().trim().min(1).max(80),
    /** For per-trade metrics (R multiple, risk:reward, plan adherence). */
    trade: getTradeSchema.optional(),
  })
  .strict();

function round(value: unknown): unknown {
  if (typeof value === "number") return Number.isInteger(value) ? value : Number(value.toFixed(4));
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, round(v)]));
  }
  return value;
}

function pick(source: Record<string, unknown>, fields?: string[]): Record<string, unknown> {
  if (!fields) return source;
  return Object.fromEntries(fields.filter((f) => f in source).map((f) => [f, source[f]]));
}

async function valueOf(ctx: ToolContext, metric: MetricEntry, trade?: z.infer<typeof getTradeSchema>): Promise<unknown> {
  const source = metric.source;
  switch (source.kind) {
    case "summary": {
      const summary = (await getAnalyticsSummary(ctx.supabase, ctx.timezone)) as unknown as Record<string, unknown>;
      const value = pick(summary, source.fields);
      // A long journal has many months; the latest two years say enough.
      if (Array.isArray(value.byMonth)) value.byMonth = value.byMonth.slice(-24);
      return value;
    }
    case "report":
      return pick((await getReport(ctx, { kind: source.report })) as Record<string, unknown>, source.fields);
    case "dashboard":
      return pick((await getDashboardStats(ctx.supabase, ctx.timezone)) as unknown as Record<string, unknown>, source.fields);
    case "attention_streak": {
      const [trades, settings] = await Promise.all([
        listTradesForStreak(ctx.supabase),
        ctx.supabase.from("user_settings").select("hidden_core_fields").maybeSingle(),
      ]);
      const hidden = ((settings.data as { hidden_core_fields?: EditableCoreField[] } | null)?.hidden_core_fields ?? []) as EditableCoreField[];
      return { days: computeAttentionStreak(trades, hidden, ctx.timezone, new Date()) };
    }
    case "trade": {
      if (!trade || (!trade.id && !trade.ticker)) {
        return { needs_trade: "This is a per-trade figure: pass trade {id} or {ticker, date} to get its value." };
      }
      return getTrade(ctx, trade);
    }
  }
}

export async function explainMetric(ctx: ToolContext, args: z.infer<typeof explainMetricSchema>) {
  const metric = findMetric(args.metric);
  if (!metric) {
    return { error: `No metric called "${args.metric}".`, known_metrics: METRIC_IDS };
  }
  return {
    metric: metric.id,
    name: metric.name,
    where_in_app: metric.where,
    definition: metric.definition,
    how_to_read: metric.howToRead,
    caveats: metric.caveats,
    your_value: round(await valueOf(ctx, metric, args.trade)),
  };
}
