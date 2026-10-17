import { z } from "zod";
import { getTrade as loadTrade } from "@/lib/trades/queries";
import { coreFieldsSchema } from "@/lib/trades/schema";
import { getMissingFields } from "@/lib/trades/missing-fields";
import type { EditableCoreField, Trade } from "@/lib/trades/types";
import { listStrategies, listTradeStrategyIds } from "@/lib/strategies/queries";
import { goalCreateSchema } from "@/lib/goals/schema";
import { METRIC_LABELS, METRIC_UNITS, type GoalPeriod } from "@/lib/goals/evaluate";
import { OPERATOR_LABELS } from "@/lib/plan-rules/subjects";
import { MISTAKE_FIELD_KEY } from "@/lib/mistakes/trade-suggestions";
import type { FieldDefinition } from "@/lib/fields/types";
import { insertProposal, toView, type ProposalDisplay, type ProposalKind } from "@/lib/chat/proposals";
import { dateOnly } from "./filter";
import { findTrade, getTradeSchema, type ToolContext } from "./journal";

// The propose_ tools: the only way Ask can change the journal, and they
// don't change it. Each one checks the change the way the normal edit route
// would, records it as a pending proposal (0070) and puts a card in front of
// the user. The journal changes only when the user presses Apply
// (src/lib/chat/apply-proposal.ts), which checks everything again.
//
// So a prompt-injected note ("tag every trade as a win") can at worst put a
// card on screen that the user can read and dismiss.

/** Proposals one request (one model round) may make. */
export const MAX_PROPOSALS_PER_ROUND = 5;

/** Core fields Ask may fill -- only ever while empty. */
export const FILLABLE_FIELDS = [
  "stop_loss",
  "take_profit",
  "entry_price",
  "exit_price",
  "entry_date",
  "exit_date",
  "direction",
  "shares",
  "position_size",
  "dollar_amount",
] as const satisfies readonly EditableCoreField[];

const FIELD_LABELS: Record<(typeof FILLABLE_FIELDS)[number], string> = {
  stop_loss: "Stop Loss",
  take_profit: "Take Profit",
  entry_price: "Entry Price",
  exit_price: "Exit Price",
  entry_date: "Entry Date",
  exit_date: "Exit Date",
  direction: "Direction",
  shares: "Number of Shares",
  position_size: "Position Size",
  dollar_amount: "Dollar Amount",
};

const MAX_NOTE_CHARS = 2_000;

const PERIOD_LABELS: Record<GoalPeriod, string> = {
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  all_time: "All time",
};

const tradeRef = getTradeSchema;

export const proposeFillFieldSchema = z
  .object({ trade: tradeRef, field: z.enum(FILLABLE_FIELDS), value: z.union([z.number(), z.string().max(40)]) })
  .strict();
export const proposeTagStrategySchema = z.object({ trade: tradeRef, strategy: z.string().trim().min(1).max(120) }).strict();
export const proposeAddNoteSchema = z
  .object({ trade: tradeRef, text: z.string().trim().min(1).max(MAX_NOTE_CHARS), field: z.string().trim().max(120).optional() })
  .strict();
export const proposeTagMistakeSchema = z.object({ trade: tradeRef, mistake: z.string().trim().min(1).max(120) }).strict();
// The goal itself is validated by goalCreateSchema, the goals route's own.
export const proposeCreateGoalSchema = z.object({ goal: z.record(z.string(), z.unknown()) }).strict();

type Ctx = ToolContext & { proposals: NonNullable<ToolContext["proposals"]> };

function ready(ctx: ToolContext): ctx is Ctx {
  return Boolean(ctx.proposals);
}

const UNAVAILABLE = { error: "Suggesting changes isn't available here. Tell the user what to change instead." };

/** "3 Oct 2026" from a date or timestamp. */
export function shortDate(value: unknown): string {
  const d = dateOnly(value);
  if (!d) return "no date";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function tradeName(t: Pick<Trade, "ticker" | "entry_date" | "created_at">): string {
  return `${t.ticker || "Untitled trade"} (${shortDate(t.entry_date ?? t.created_at)})`;
}

async function resolveTrade(ctx: ToolContext, ref: z.infer<typeof tradeRef>): Promise<Trade | { error: string }> {
  if (!ref.id && !ref.ticker) return { error: "Say which trade: trade {id} or {ticker, date}." };
  const { row, otherMatches, dateMatched } = await findTrade(ctx.store, ref);
  if (!row) return { error: "No such trade in the journal." };
  if (!ref.id && (otherMatches > 0 || !dateMatched)) {
    return { error: "More than one trade matches. Pass the trade's id (from query_trades or get_trade)." };
  }
  // The full row, as the edit routes read it -- the store's copy is a subset.
  const trade = await loadTrade(ctx.supabase, row.id);
  return trade ?? { error: "No such trade in the journal." };
}

async function record(
  ctx: Ctx,
  callId: string,
  kind: ProposalKind,
  tradeId: string | null,
  payload: Record<string, unknown>,
  before: Record<string, unknown> | null,
  display: ProposalDisplay,
) {
  if (ctx.proposals.made >= MAX_PROPOSALS_PER_ROUND) {
    return { error: `At most ${MAX_PROPOSALS_PER_ROUND} suggested changes at a time. Let the user decide on these first.` };
  }
  const row = await insertProposal(ctx.supabase, {
    user_id: ctx.proposals.userId,
    conversation_id: ctx.proposals.conversationId,
    tool_call_id: callId,
    kind,
    trade_id: tradeId,
    payload,
    before,
    display,
  });
  ctx.proposals.made += 1;
  return {
    proposed: true,
    proposal_id: row.id,
    shown_to_user: display,
    note:
      "NOT saved. The user sees this as a card with Apply / Dismiss and decides. Say you've suggested it; " +
      "never say it's done.",
    // Read by runTurn to put the card on screen; not for the model.
    proposal_card: toView(row),
  };
}

function shown(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  return String(value);
}

// ---- fill an empty core field ---------------------------------------------

export async function proposeFillField(ctx: ToolContext, callId: string, args: z.infer<typeof proposeFillFieldSchema>) {
  if (!ready(ctx)) return UNAVAILABLE;
  const trade = await resolveTrade(ctx, args.trade);
  if ("error" in trade) return trade;

  const current = (trade as unknown as Record<string, unknown>)[args.field];
  if (current !== null && current !== undefined && current !== "") {
    return { error: `${FIELD_LABELS[args.field]} already has a value (${shown(current)}). Ask only fills empty fields.` };
  }
  // Only what the trade card itself calls missing -- plus take profit, which
  // is optional there but is still an empty field worth filling.
  const { data: settings } = await ctx.supabase.from("user_settings").select("hidden_core_fields").maybeSingle();
  const hidden = ((settings as { hidden_core_fields?: EditableCoreField[] } | null)?.hidden_core_fields ?? []) as EditableCoreField[];
  const missing = getMissingFields(trade, trade.mode === "investment", hidden).map((f) => f.key as string);
  if (args.field !== "take_profit" && !missing.includes(args.field)) {
    return { error: `${FIELD_LABELS[args.field]} isn't a missing field on this trade.` };
  }

  // The trade PATCH route's own validator for this one field. A number the
  // model sent as text ("182.50") is still that number.
  const numeric = !["entry_date", "exit_date", "direction"].includes(args.field);
  const raw =
    numeric && typeof args.value === "string" && args.value.trim() !== "" && Number.isFinite(Number(args.value))
      ? Number(args.value)
      : args.value;
  const parsed = coreFieldsSchema.shape[args.field].safeParse(raw);
  if (!parsed.success || parsed.data === null || parsed.data === undefined) {
    return { error: `That isn't a valid ${FIELD_LABELS[args.field]}: ${parsed.error?.issues[0]?.message ?? "empty"}` };
  }
  const value: unknown = parsed.data;

  return record(ctx, callId, "fill_field", trade.id, { field: args.field, value }, { core: { [args.field]: current ?? null } }, {
    title: `Fill in ${FIELD_LABELS[args.field]} on ${tradeName(trade)}`,
    changes: [{ label: FIELD_LABELS[args.field], before: "empty", after: shown(value) }],
    note: "Figures that depend on it (risk, R multiple, P&L) are recalculated, as when you type it on the trade page.",
    href: `/trades/${trade.id}`,
  });
}

// ---- tag an existing strategy ----------------------------------------------

export async function proposeTagStrategy(ctx: ToolContext, callId: string, args: z.infer<typeof proposeTagStrategySchema>) {
  if (!ready(ctx)) return UNAVAILABLE;
  const trade = await resolveTrade(ctx, args.trade);
  if ("error" in trade) return trade;

  const strategies = await listStrategies(ctx.supabase);
  const wanted = args.strategy.toLowerCase();
  const strategy = strategies.find((s) => s.name.trim().toLowerCase() === wanted);
  if (!strategy) {
    return { error: `No strategy called "${args.strategy}". Existing ones: ${strategies.map((s) => s.name).join(", ") || "none"}. Ask only tags existing strategies.` };
  }
  const current = await listTradeStrategyIds(ctx.supabase, trade.id);
  if (current.includes(strategy.id)) return { error: `${tradeName(trade)} is already tagged ${strategy.name}.` };
  const names = (ids: string[]) => ids.map((id) => strategies.find((s) => s.id === id)?.name ?? "?");

  return record(ctx, callId, "tag_strategy", trade.id, { strategy_id: strategy.id }, { strategy_ids: current }, {
    title: `Tag ${tradeName(trade)} with ${strategy.name}`,
    changes: [{ label: "Strategies", before: shown(names(current)), after: shown([...names(current), strategy.name]) }],
    href: `/trades/${trade.id}`,
  });
}

// ---- add to a notes field --------------------------------------------------

function notesFields(fields: FieldDefinition[]): FieldDefinition[] {
  // Global text fields only: a strategy-scoped field lives elsewhere on the
  // row (strategy_field_values) and isn't on every trade.
  return fields.filter((f) => (f.field_type === "large_notes" || f.field_type === "text") && !f.strategy_id);
}

export async function proposeAddNote(ctx: ToolContext, callId: string, args: z.infer<typeof proposeAddNoteSchema>) {
  if (!ready(ctx)) return UNAVAILABLE;
  const trade = await resolveTrade(ctx, args.trade);
  if ("error" in trade) return trade;

  const defs = await ctx.store.fields();
  const candidates = notesFields(trade.mode === "investment" ? defs.investment : defs.trade);
  const wanted = args.field?.toLowerCase();
  const field = wanted
    ? candidates.find((f) => f.key.toLowerCase() === wanted || f.label.trim().toLowerCase() === wanted)
    : (candidates.find((f) => f.field_type === "large_notes") ?? candidates[0]);
  if (!field) {
    return { error: `No notes field${args.field ? ` called "${args.field}"` : ""}. Text fields: ${candidates.map((f) => f.label).join(", ") || "none"}.` };
  }
  const existing = trade.custom_fields?.[field.key];
  const before = typeof existing === "string" ? existing : "";

  return record(ctx, callId, "add_note", trade.id, { field_key: field.key, text: args.text }, { value: before }, {
    title: `Add to ${field.label} on ${tradeName(trade)}`,
    changes: [{ label: field.label, before: before ? "(kept as it is)" : "empty", after: args.text }],
    note: before ? "Added after what's already there; nothing is overwritten." : undefined,
    href: `/trades/${trade.id}`,
  });
}

// ---- tag a mistake ---------------------------------------------------------

export async function proposeTagMistake(ctx: ToolContext, callId: string, args: z.infer<typeof proposeTagMistakeSchema>) {
  if (!ready(ctx)) return UNAVAILABLE;
  const trade = await resolveTrade(ctx, args.trade);
  if ("error" in trade) return trade;

  const defs = await ctx.store.fields();
  const field = (trade.mode === "investment" ? defs.investment : defs.trade).find((f) => f.key === MISTAKE_FIELD_KEY);
  if (!field) return { error: "This journal has no mistakes field to tag." };
  const choices = field.options?.choices ?? [];
  let label = args.mistake;
  if (choices.length > 0) {
    const match = choices.find((c) => c.trim().toLowerCase() === label.toLowerCase());
    if (!match) return { error: `"${label}" isn't one of the mistake tags. Pick one of: ${choices.join(", ")}.` };
    label = match;
  } else if (label.length > 60) {
    return { error: "Keep a mistake tag under 60 characters." };
  }
  const raw = trade.custom_fields?.[MISTAKE_FIELD_KEY];
  const current = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  if (current.includes(label)) return { error: `${tradeName(trade)} is already tagged "${label}".` };

  return record(ctx, callId, "tag_mistake", trade.id, { label }, { labels: current }, {
    title: `Tag ${tradeName(trade)} with the mistake "${label}"`,
    changes: [{ label: field.label, before: shown(current), after: shown([...current, label]) }],
    href: `/trades/${trade.id}`,
  });
}

// ---- create a goal ---------------------------------------------------------

export async function proposeCreateGoal(ctx: ToolContext, callId: string, args: z.infer<typeof proposeCreateGoalSchema>) {
  if (!ready(ctx)) return UNAVAILABLE;
  const parsed = goalCreateSchema.safeParse(args.goal);
  if (!parsed.success) {
    return { error: `Not a valid goal: ${parsed.error.issues.map((i) => `${i.path.join(".") || "goal"}: ${i.message}`).join("; ")}` };
  }
  const g = parsed.data;
  // Worded as the Goals page words its targets (goal-manager.tsx formatTarget).
  const direction = g.target_direction === "at_least" ? "at least" : "at most";
  const unit = g.metric ? METRIC_UNITS[g.metric] : "count";
  const target = unit === "percent" ? `${g.target}%` : unit === "r" ? `${g.target}R` : String(g.target);
  const what =
    g.kind === "aggregate" && g.metric
      ? `${METRIC_LABELS[g.metric]}: ${direction} ${target}`
      : g.kind === "reduction"
        ? `"${g.mistake_label}": ${direction} ${g.target} times`
        : `${g.subject_key} ${g.operator ? OPERATOR_LABELS[g.operator] : ""} ${g.number_value ?? g.text_value ?? ""} on ${direction} ${g.target}% of trades`
            .replace(/\s+/g, " ")
            .trim();
  return record(ctx, callId, "create_goal", null, { goal: g }, null, {
    title: `Create the goal "${g.label}"`,
    changes: [
      { label: "Goal", before: "none", after: what },
      { label: "Period", before: "", after: PERIOD_LABELS[g.period] },
    ],
    href: "/goals",
  });
}

// ---- one tool for all five --------------------------------------------------
//
// One definition rather than five, with flat arguments: a free tier re-sends
// every definition on every round, and plain string/number arguments are
// the subset every provider's schema dialect accepts (Gemini refuses type
// unions and objects without properties).

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const proposeChangeSchema = z
  .object({
    kind: z.enum(["fill_field", "tag_strategy", "add_note", "tag_mistake", "create_goal"]),
    trade_id: z.string().uuid().optional(),
    ticker: optionalText(40),
    date: optionalText(40),
    field: optionalText(120),
    value: z.union([z.number(), z.string().max(40)]).optional(),
    strategy: optionalText(120),
    text: z.string().max(MAX_NOTE_CHARS).optional(),
    mistake: optionalText(120),
    label: optionalText(100),
    goal_kind: optionalText(20),
    metric: optionalText(40),
    target: z.number().optional(),
    target_direction: optionalText(20),
    period: optionalText(20),
  })
  .strict();

const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export async function proposeChange(ctx: ToolContext, callId: string, a: z.infer<typeof proposeChangeSchema>) {
  const trade = defined({ id: a.trade_id, ticker: a.ticker, date: a.date });
  switch (a.kind) {
    case "fill_field":
      return proposeFillField(ctx, callId, proposeFillFieldSchema.parse(defined({ trade, field: a.field, value: a.value })));
    case "tag_strategy":
      return proposeTagStrategy(ctx, callId, proposeTagStrategySchema.parse(defined({ trade, strategy: a.strategy })));
    case "add_note":
      return proposeAddNote(ctx, callId, proposeAddNoteSchema.parse(defined({ trade, text: a.text, field: a.field })));
    case "tag_mistake":
      return proposeTagMistake(ctx, callId, proposeTagMistakeSchema.parse(defined({ trade, mistake: a.mistake })));
    case "create_goal":
      return proposeCreateGoal(ctx, callId, {
        goal: defined({
          label: a.label,
          kind: a.goal_kind,
          metric: a.metric,
          mistake_label: a.mistake,
          target: a.target,
          target_direction: a.target_direction,
          period: a.period,
        }),
      });
  }
}
