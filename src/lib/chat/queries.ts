import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/supabase/errors";
import type { ToolCall } from "@/lib/ai-keys/providers/types";
import type { AIProviderName } from "@/lib/ai-keys/types";

// Reads and writes for `ai_conversations` and `ai_messages` (0047).
//
// Everything goes through the RLS-scoped client, so the owner policies
// confine every statement to the signed-in user's own rows. Nothing here
// needs -- or should get -- the service-role client. `user_id` is still
// written on every insert because the policy's `with check` requires it.

/** Oldest conversations beyond this are pruned when a new one is created. */
export const MAX_CONVERSATIONS_PER_USER = 50;
/** A conversation past this many rows refuses new turns; start a new one. */
export const MAX_MESSAGES_PER_CONVERSATION = 400;

export interface Conversation {
  id: string;
  title: string | null;
  provider: AIProviderName;
  model: string;
  key_id: string | null;
  message_count: number;
  last_message_at: string;
  created_at: string;
}

export type MessageRole = "user" | "assistant" | "tool";
export type MessageStatus = "complete" | "interrupted" | "error";

export interface MessageRow {
  id: string;
  seq: number;
  role: MessageRole;
  content: string;
  tool_calls: ToolCall[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  parts: unknown[] | null;
  status: MessageStatus;
  created_at: string;
}

const CONVERSATION_COLUMNS =
  "id, title, provider, model, key_id, message_count, last_message_at, created_at";
const MESSAGE_COLUMNS =
  "id, seq, role, content, tool_calls, tool_call_id, tool_name, parts, status, created_at";

// ---- Conversations --------------------------------------------------------

export async function listConversations(supabase: SupabaseClient): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("ai_conversations")
    .select(CONVERSATION_COLUMNS)
    // Empty conversations (created, never spoken to) are hidden from the
    // list; they are pruned on the next create.
    .gt("message_count", 0)
    .order("last_message_at", { ascending: false })
    .limit(MAX_CONVERSATIONS_PER_USER);
  if (error) {
    // A pending 0047 must degrade to "no conversations", not take /ask down.
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as Conversation[];
}

export async function getConversation(
  supabase: SupabaseClient,
  id: string,
): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from("ai_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as unknown as Conversation) ?? null;
}

export async function createConversation(
  supabase: SupabaseClient,
  userId: string,
  input: { provider: AIProviderName; model: string; keyId: string },
): Promise<Conversation> {
  await pruneConversations(supabase);

  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({
      user_id: userId,
      provider: input.provider,
      model: input.model,
      key_id: input.keyId,
    })
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as Conversation;
}

/**
 * Rename, or move to another key. A key change always carries the key's
 * provider and model with it: the provider is what the turn route builds
 * the transcript for, so a conversation whose `provider` said Groq while
 * `key_id` pointed at an OpenAI key would send one provider's tool-call
 * bookkeeping to another.
 */
export async function updateConversation(
  supabase: SupabaseClient,
  id: string,
  patch: { title?: string | null; key?: { key_id: string; provider: AIProviderName; model: string } },
): Promise<Conversation | null> {
  const { key, ...rest } = patch;
  const { data, error } = await supabase
    .from("ai_conversations")
    .update({ ...rest, ...(key ?? {}) })
    .eq("id", id)
    .select(CONVERSATION_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Conversation) ?? null;
}

/** Returns false when nothing matched -- the route turns that into a 404. */
export async function deleteConversation(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Best-effort housekeeping before a create: drop conversations that were
 * opened and never used, then anything beyond the cap, oldest first. Errors
 * are swallowed -- a failed prune must not block starting a conversation.
 */
async function pruneConversations(supabase: SupabaseClient): Promise<void> {
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("ai_conversations")
      .delete()
      .eq("message_count", 0)
      .lt("created_at", dayAgo);

    const { data } = await supabase
      .from("ai_conversations")
      .select("id")
      .order("last_message_at", { ascending: false })
      .range(MAX_CONVERSATIONS_PER_USER - 1, MAX_CONVERSATIONS_PER_USER + 199);
    const ids = (data ?? []).map((r) => r.id as string);
    if (ids.length > 0) {
      await supabase.from("ai_conversations").delete().in("id", ids);
    }
  } catch {
    // Intentionally swallowed; see above.
  }
}

// ---- Messages -------------------------------------------------------------

/**
 * The rows of one conversation, oldest first.
 *
 * Filtered by `user_id` as well as `conversation_id`, deliberately. RLS is
 * the boundary, but 0047's policy only checked the row's own user_id, which
 * let a signed-in stranger who knew a conversation's UUID INSERT rows into
 * it through PostgREST (the FK check bypasses RLS); reading by conversation
 * alone then fed those rows into the owner's model transcript. 0048 closes
 * the policy; this filter means the transcript is built only from rows the
 * owner wrote even if a policy regresses.
 */
export async function listMessages(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("ai_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("seq", { ascending: true })
    .limit(MAX_MESSAGES_PER_CONVERSATION + 1);
  if (error) throw error;
  return (data ?? []) as unknown as MessageRow[];
}

export interface NewMessage {
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[] | null;
  tool_call_id?: string | null;
  tool_name?: string | null;
  parts?: unknown[] | null;
  status?: MessageStatus;
}

/**
 * Appends one row at `seq`. The caller allocates `seq` as (last seq + 1) and
 * the unique index on (conversation_id, seq) is what makes two concurrent
 * turns collide: the loser gets 23505, which `isBusyError` recognises.
 */
export async function insertMessage(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  seq: number,
  message: NewMessage,
): Promise<MessageRow> {
  const { data, error } = await supabase
    .from("ai_messages")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      seq,
      role: message.role,
      content: message.content,
      tool_calls: message.tool_calls ?? null,
      tool_call_id: message.tool_call_id ?? null,
      tool_name: message.tool_name ?? null,
      parts: message.parts ?? null,
      status: message.status ?? "complete",
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as MessageRow;
}

/**
 * The assistant row is inserted empty before the model call and completed
 * after it, so this is how its text, tool calls and status land. Tool and
 * user rows are never updated.
 */
export async function updateMessage(
  supabase: SupabaseClient,
  id: string,
  patch: { content?: string; status?: MessageStatus; tool_calls?: ToolCall[] | null },
): Promise<void> {
  const { error } = await supabase.from("ai_messages").update(patch).eq("id", id);
  if (error) throw error;
}

/** Keeps the conversation's list metadata current; one call per turn. */
export async function touchConversation(
  supabase: SupabaseClient,
  id: string,
  patch: { message_count: number; title?: string },
): Promise<void> {
  const { error } = await supabase
    .from("ai_conversations")
    .update({ ...patch, last_message_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Postgres unique-violation: another turn on this conversation got there first. */
export function isBusyError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

// ---- Turn claim ------------------------------------------------------------

/**
 * How long a claim is honoured before it is considered abandoned. Just past
 * the turn route's own budget, so a request the platform killed mid-flight
 * frees the conversation on its own rather than locking it until someone
 * notices.
 */
export const TURN_CLAIM_TTL_MS = 25_000;

/**
 * Claims the conversation for one turn, or reports that another turn holds
 * it. One conditional UPDATE: the row is taken only when `turn_started_at`
 * is null or older than the TTL, so two requests racing on the same
 * conversation cannot both win -- Postgres serialises the update.
 *
 * The unique (conversation_id, seq) index is NOT enough on its own: it
 * serialises the insert of the assistant row, not the 20-second model call
 * after it, and a second request arriving mid-stream saw no collision and
 * started a second call on the same transcript.
 *
 * Degrades to "claimed" when the column does not exist yet (0048 pending):
 * a missing migration must make the chat less safe against a race, not dead.
 */
export async function claimTurn(supabase: SupabaseClient, id: string): Promise<boolean> {
  const now = new Date();
  const stale = new Date(now.getTime() - TURN_CLAIM_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("ai_conversations")
    .update({ turn_started_at: now.toISOString() })
    .eq("id", id)
    .or(`turn_started_at.is.null,turn_started_at.lt.${stale}`)
    .select("id");
  if (error) {
    if (isMissingColumnError(error)) return true;
    throw error;
  }
  return (data?.length ?? 0) > 0;
}

/** Frees the claim. Best-effort: the TTL covers a release that never ran. */
export async function releaseTurn(supabase: SupabaseClient, id: string): Promise<void> {
  try {
    await supabase.from("ai_conversations").update({ turn_started_at: null }).eq("id", id);
  } catch {
    // The TTL expires it; see claimTurn.
  }
}

/** 42703 (Postgres) / PGRST204 (PostgREST schema cache): the column is not there. */
function isMissingColumnError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42703" || code === "PGRST204";
}
