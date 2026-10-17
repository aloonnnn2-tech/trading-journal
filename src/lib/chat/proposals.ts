import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/supabase/errors";

// Changes Ask suggests and the user applies with a click (0070).
//
// The model can only call a propose_ tool (src/lib/ai-keys/tools/proposals.ts),
// which validates the change, records it here as `pending` and shows the
// user a card built from the stored `display`. Nothing is written to the
// journal until the user presses Apply (src/lib/chat/apply-proposal.ts).

export const PROPOSAL_KINDS = ["fill_field", "tag_strategy", "add_note", "tag_mistake", "create_goal"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export type ProposalStatus = "pending" | "applying" | "applied" | "dismissed" | "stale" | "failed";

/** What the card shows -- built by the server, never by the model. */
export interface ProposalDisplay {
  /** "Fill in Stop Loss on AAPL (3 Oct 2026)". */
  title: string;
  /** The change, field by field. */
  changes: { label: string; before: string; after: string }[];
  /** Anything else the user should know before applying. */
  note?: string;
  /** Where to see the result afterwards. */
  href?: string;
}

/** A proposal as the browser gets it. */
export interface ProposalView {
  id: string;
  toolCallId: string;
  kind: ProposalKind;
  status: ProposalStatus;
  display: ProposalDisplay;
  outcome: string | null;
}

export interface ProposalRow {
  id: string;
  user_id: string;
  conversation_id: string;
  tool_call_id: string;
  kind: ProposalKind;
  trade_id: string | null;
  payload: Record<string, unknown>;
  before: Record<string, unknown> | null;
  display: ProposalDisplay;
  status: ProposalStatus;
  outcome: string | null;
  created_at: string;
  resolved_at: string | null;
}

const COLUMNS = "id, user_id, conversation_id, tool_call_id, kind, trade_id, payload, before, display, status, outcome, created_at, resolved_at";

export function toView(row: ProposalRow): ProposalView {
  return { id: row.id, toolCallId: row.tool_call_id, kind: row.kind, status: row.status, display: row.display, outcome: row.outcome };
}

/** False until 0070 is applied; Ask then simply doesn't offer changes. */
export async function proposalsAvailable(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("ai_proposals").select("id").limit(1);
  return !error || !isMissingTableError(error);
}

/**
 * Records a proposal, or returns the one this tool call already made -- a
 * round re-run after an interruption must not put a second card up.
 */
export async function insertProposal(
  supabase: SupabaseClient,
  input: Omit<ProposalRow, "id" | "status" | "outcome" | "created_at" | "resolved_at">,
): Promise<ProposalRow> {
  const { data, error } = await supabase.from("ai_proposals").insert(input).select(COLUMNS).single();
  if (!error) return data as unknown as ProposalRow;
  if ((error as { code?: string }).code === "23505") {
    const existing = await supabase
      .from("ai_proposals")
      .select(COLUMNS)
      .eq("conversation_id", input.conversation_id)
      .eq("tool_call_id", input.tool_call_id)
      .single();
    if (!existing.error) return existing.data as unknown as ProposalRow;
  }
  throw error;
}

export async function getProposal(supabase: SupabaseClient, id: string): Promise<ProposalRow | null> {
  const { data, error } = await supabase.from("ai_proposals").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as unknown as ProposalRow | null) ?? null;
}

export async function listProposals(supabase: SupabaseClient, conversationId: string): Promise<ProposalRow[]> {
  const { data, error } = await supabase
    .from("ai_proposals")
    .select(COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at");
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as ProposalRow[];
}

/**
 * pending -> `to`, only if it is still pending. The conditional update is
 * what makes a double click apply once: the second click finds nothing to
 * claim.
 */
export async function claimProposal(
  supabase: SupabaseClient,
  id: string,
  to: "applying" | "dismissed",
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ai_proposals")
    .update({ status: to, ...(to === "dismissed" ? { resolved_at: new Date().toISOString() } : {}) })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function finishProposal(
  supabase: SupabaseClient,
  id: string,
  status: "applied" | "stale" | "failed" | "pending",
  outcome: string | null = null,
): Promise<void> {
  const { error } = await supabase
    .from("ai_proposals")
    .update({ status, outcome, resolved_at: status === "pending" ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** For the system prompt: what became of the suggestions made so far. */
export function describeOutcomes(rows: ProposalRow[]): string | null {
  const resolved = rows.slice(-12);
  if (resolved.length === 0) return null;
  const word: Record<ProposalStatus, string> = {
    pending: "not decided yet",
    applying: "being applied",
    applied: "APPLIED by the user",
    dismissed: "dismissed by the user",
    stale: "not applied -- the trade changed since",
    failed: "could not be applied",
  };
  return resolved.map((r) => `- ${oneLine(r.display.title)}: ${word[r.status]}`).join("\n");
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").slice(0, 160);
}
