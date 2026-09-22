import { z } from "zod";
import { getStrategyBreakdown } from "@/lib/strategies/queries";
import { listCommissionRules } from "@/lib/commissions/queries";
import { localDateParts } from "@/lib/dates/local-day";
import { getLocalDayName } from "@/lib/dates/day-of-week";
import { limited } from "./envelope";
import { round } from "./filter";
import type { ToolContext } from "./journal";

// The trader's setup: how the journal is configured, as opposed to what is
// in it. Strategies and their rules, custom fields, folders, commission
// rules, and the settings the model needs to interpret dates.

export const listStrategiesSchema = z.object({}).strict();
export const listCustomFieldsSchema = z.object({}).strict();
export const listFoldersSchema = z.object({ folder: z.string().max(120).optional() }).strict();
export const listCommissionRulesSchema = z.object({}).strict();
export const getSettingsSchema = z.object({}).strict();

export async function listStrategies(ctx: ToolContext) {
  const [strategies, rulesByStrategy, breakdown] = await Promise.all([
    ctx.store.strategies(),
    ctx.store.rulesByStrategy(),
    getStrategyBreakdown(ctx.supabase).catch(() => []),
  ]);
  const items = strategies.map((s) => {
    const stats = breakdown.find((b) => b.strategy.id === s.id);
    const rules = (rulesByStrategy[s.id] ?? []).filter((r) => r.enabled);
    return {
      name: s.name,
      description: s.description ?? null,
      trades: stats?.trades ?? 0,
      winRate: stats?.winRate ?? null,
      totalPL: round(stats?.totalPL) ?? 0,
      rules: rules.map((r) => ({
        rule: r.label,
        checks: `${r.subject_key} ${r.operator} ${r.text_value ?? r.number_value ?? ""}${r.number_value_max != null ? `–${r.number_value_max}` : ""}`.trim(),
      })),
    };
  });
  return limited(items, 50);
}

export async function listCustomFields(ctx: ToolContext) {
  const [fields, strategies] = await Promise.all([ctx.store.fields(), ctx.store.strategies()]);
  const describe = (f: (typeof fields.trade)[number]) => ({
    label: f.label,
    key: f.key,
    type: f.field_type,
    ...(Array.isArray((f.options as { choices?: unknown })?.choices)
      ? { choices: (f.options as { choices: unknown[] }).choices.map(String).slice(0, 40) }
      : {}),
  });
  return {
    trade_fields: fields.trade.map(describe),
    investment_fields: fields.investment.map(describe),
    strategy_fields: Object.entries(fields.byStrategy)
      .map(([sid, defs]) => ({
        strategy: strategies.find((s) => s.id === sid)?.name ?? sid,
        fields: defs.map(describe),
      }))
      .filter((x) => x.fields.length > 0),
  };
}

export async function listFolders(ctx: ToolContext, args: z.infer<typeof listFoldersSchema>) {
  const { folders, links } = await ctx.store.folders();
  const counts = new Map<string, number>();
  for (const ids of Object.values(links)) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  if (args.folder) {
    const f = folders.find((x) => x.name.toLowerCase() === args.folder!.toLowerCase());
    if (!f) return { found: false, folders: folders.map((x) => x.name) };
    const tradeIds = Object.entries(links)
      .filter(([, ids]) => ids.includes(f.id))
      .map(([tradeId]) => tradeId);
    return { found: true, folder: f.name, trades: limited(tradeIds, 100) };
  }
  return limited(
    folders.map((f) => ({ name: f.name, trades: counts.get(f.id) ?? 0 })),
    50,
  );
}

export async function listCommissionRulesTool(ctx: ToolContext) {
  const rules = await listCommissionRules(ctx.supabase);
  return limited(
    rules.map((r) => ({
      name: r.name,
      type: r.rule_type,
      amount: r.amount,
      applies_to: r.applies_to,
      asset_type: r.asset_type,
      market: r.market,
      min_fee: r.min_fee,
      max_fee: r.max_fee,
      enabled: r.enabled,
    })),
    50,
  );
}

/** Timezone and today's date -- what the model needs to resolve "this week". */
export function getSettings(ctx: ToolContext) {
  const now = new Date();
  // localDateParts' month is 0-indexed (matches JS Date).
  const { year, month, day } = localDateParts(now, ctx.timezone);
  const today = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    timezone: ctx.timezone ?? "UTC",
    today,
    weekday: getLocalDayName(now.toISOString(), ctx.timezone),
  };
}
