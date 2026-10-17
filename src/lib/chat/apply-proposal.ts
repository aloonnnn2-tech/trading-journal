import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TradeConflictError, getTrade, updateTrade } from "@/lib/trades/queries";
import { coreFieldsSchema } from "@/lib/trades/schema";
import { listTradeStrategyIds, setTradeStrategies } from "@/lib/strategies/queries";
import { createGoal } from "@/lib/goals/queries";
import { goalCreateSchema, toGoalRow } from "@/lib/goals/schema";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { MISTAKE_FIELD_KEY } from "@/lib/mistakes/trade-suggestions";
import { isMissingTableError } from "@/lib/supabase/errors";
import { FILLABLE_FIELDS } from "@/lib/ai-keys/tools/proposals";
import {
  claimProposal,
  finishProposal,
  getProposal,
  toView,
  type ProposalRow,
  type ProposalView,
} from "./proposals";

// Apply: the one place a suggestion from Ask becomes a change in the journal,
// and only because the user pressed the button.
//
// Nothing is taken on trust from when the proposal was made. The stored
// payload is validated again by the same schemas the edit routes use, and
// written through the same functions -- with the values the user was shown
// as "before" as the changed-since check where a stale change would
// overwrite something. Notes and mistake tags are written to their one
// custom-field key and nothing else, like the suggestions route, so applying
// one never recomputes the trade's P&L (see that route for why).

export type ApplyResult =
  | { kind: "not_found" }
  | { kind: "done"; proposal: ProposalView };

type Outcome = { status: "applied" | "stale" | "failed"; outcome: string | null };

export async function applyProposal(supabase: SupabaseClient, userId: string, id: string): Promise<ApplyResult> {
  const row = await getProposal(supabase, id);
  if (!row) return { kind: "not_found" };

  // pending -> applying, once. A second click (or a second tab) finds it
  // already claimed and gets the state as it stands.
  if (!(await claimProposal(supabase, id, "applying"))) {
    return { kind: "done", proposal: toView((await getProposal(supabase, id)) ?? row) };
  }

  let result: Outcome;
  try {
    result = await applyKind(supabase, userId, row);
  } catch (err) {
    result = { status: "failed", outcome: describeFailure(err) };
  }
  await finishProposal(supabase, id, result.status, result.outcome);
  return { kind: "done", proposal: { ...toView(row), status: result.status, outcome: result.outcome } };
}

export async function dismissProposal(supabase: SupabaseClient, id: string): Promise<ApplyResult> {
  const row = await getProposal(supabase, id);
  if (!row) return { kind: "not_found" };
  await claimProposal(supabase, id, "dismissed");
  return { kind: "done", proposal: toView((await getProposal(supabase, id)) ?? row) };
}

function describeFailure(err: unknown): string {
  if (isMissingTableError(err)) return "Goals aren't set up on this server yet.";
  if (err instanceof Error && /not found/i.test(err.message)) return "It no longer exists.";
  return "It couldn't be saved. Nothing was changed.";
}

const GONE: Outcome = { status: "failed", outcome: "The trade no longer exists." };

async function applyKind(supabase: SupabaseClient, userId: string, row: ProposalRow): Promise<Outcome> {
  const p = row.payload;
  switch (row.kind) {
    case "fill_field": {
      const { field, value } = z.object({ field: z.enum(FILLABLE_FIELDS), value: z.unknown() }).parse(p);
      const parsed = coreFieldsSchema.shape[field].parse(value);
      if (parsed === null || parsed === undefined || !row.trade_id) return { status: "failed", outcome: "Nothing to fill in." };
      const before = z.object({ core: z.record(z.string(), z.unknown()) }).parse(row.before);
      try {
        // `base` = what the card said was there (empty). If the field has
        // been filled in since, this refuses rather than overwrite it.
        await updateTrade(supabase, row.trade_id, { core: { [field]: parsed } }, { base: { core: before.core } });
      } catch (err) {
        if (err instanceof TradeConflictError) {
          return { status: "stale", outcome: "That field has been filled in since. Nothing was changed." };
        }
        throw err;
      }
      return { status: "applied", outcome: null };
    }

    case "tag_strategy": {
      const { strategy_id } = z.object({ strategy_id: z.string().uuid() }).parse(p);
      if (!row.trade_id || !(await getTrade(supabase, row.trade_id))) return GONE;
      // The trade's strategies as they are NOW plus this one, so a tag added
      // or removed elsewhere since the suggestion is kept, not undone.
      const current = await listTradeStrategyIds(supabase, row.trade_id);
      if (!current.includes(strategy_id)) await setTradeStrategies(supabase, row.trade_id, [...current, strategy_id]);
      return { status: "applied", outcome: null };
    }

    case "add_note": {
      const { field_key, text } = z.object({ field_key: z.string().max(120), text: z.string().min(1).max(2_000) }).parse(p);
      const trade = row.trade_id ? await getTrade(supabase, row.trade_id) : null;
      if (!trade) return GONE;
      const defs = await listFieldDefinitions(supabase, trade.mode === "investment" ? "investment" : "trade");
      const field = defs.find((f) => f.key === field_key && !f.strategy_id && (f.field_type === "large_notes" || f.field_type === "text"));
      if (!field) return { status: "failed", outcome: "That notes field no longer exists." };
      // Added after whatever is there NOW -- an edit made since is kept.
      const existing = trade.custom_fields?.[field_key];
      const next = typeof existing === "string" && existing.trim() ? `${existing}\n\n${text}` : text;
      const { error } = await supabase
        .from("trades")
        .update({ custom_fields: { ...trade.custom_fields, [field_key]: next } })
        .eq("id", trade.id);
      if (error) throw error;
      return { status: "applied", outcome: null };
    }

    case "tag_mistake": {
      const { label } = z.object({ label: z.string().min(1).max(120) }).parse(p);
      const trade = row.trade_id ? await getTrade(supabase, row.trade_id) : null;
      if (!trade) return GONE;
      const defs = await listFieldDefinitions(supabase, trade.mode === "investment" ? "investment" : "trade");
      const field = defs.find((f) => f.key === MISTAKE_FIELD_KEY);
      const choices = field?.options?.choices ?? [];
      if (!field || (choices.length > 0 && !choices.includes(label))) {
        return { status: "failed", outcome: "That mistake tag no longer exists." };
      }
      const raw = trade.custom_fields?.[MISTAKE_FIELD_KEY];
      const current = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
      if (current.includes(label)) return { status: "applied", outcome: null };
      const { error } = await supabase
        .from("trades")
        .update({ custom_fields: { ...trade.custom_fields, [MISTAKE_FIELD_KEY]: [...current, label] } })
        .eq("id", trade.id);
      if (error) throw error;
      return { status: "applied", outcome: null };
    }

    case "create_goal": {
      const goal = goalCreateSchema.parse(z.object({ goal: z.unknown() }).parse(p).goal);
      await createGoal(supabase, userId, toGoalRow(goal));
      return { status: "applied", outcome: null };
    }
  }
}
