import type { MessageRow, MessageStatus } from "./queries";
import { labelForTool } from "./labels";

/**
 * What the UI renders: stored rows folded into user-visible turns.
 *
 * A "turn" is one user message and everything the model did in response:
 * the tool activity (from assistant tool_calls + tool rows) and the final
 * answer. Pure and shared -- the page uses it to render a loaded
 * conversation, and the client uses it to fold live stream events into the
 * same shape, so a reloaded conversation looks exactly like it did live.
 */
export interface Activity {
  toolCallId: string;
  name: string;
  label: string;
  /** False when the tool row reported an error, e.g. {"error": "..."}. */
  ok: boolean;
}

export interface TurnView {
  user: { id: string; content: string };
  activity: Activity[];
  answer?: { id: string; content: string; status: MessageStatus | "streaming" };
}

export function foldMessages(rows: MessageRow[]): TurnView[] {
  const turns: TurnView[] = [];
  let current: TurnView | null = null;
  // Pending tool calls from the latest assistant row, so the matching tool
  // rows can be labelled even when they arrive out of call order.
  const pending = new Map<string, { name: string }>();

  for (const row of rows) {
    if (row.role === "user") {
      current = { user: { id: row.id, content: row.content }, activity: [] };
      turns.push(current);
      pending.clear();
      continue;
    }
    if (!current) continue; // a stray non-user row before any user message

    if (row.role === "assistant") {
      if (row.tool_calls && row.tool_calls.length > 0) {
        for (const c of row.tool_calls) pending.set(c.id, { name: c.name });
        // An assistant turn that only asked for tools is not an answer; any
        // text it carried is intermediate narration and is not shown.
        continue;
      }
      current.answer = { id: row.id, content: row.content, status: row.status };
      continue;
    }

    // tool row
    const id = row.tool_call_id ?? "";
    const name = row.tool_name ?? pending.get(id)?.name ?? "tool";
    current.activity.push({
      toolCallId: id,
      name,
      label: labelForTool(name),
      ok: !looksLikeError(row.content),
    });
  }

  return turns;
}

/** Tool executors never throw; they return {"error": ...} on failure. */
function looksLikeError(content: string): boolean {
  if (!content.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(content) as { error?: unknown };
    return typeof parsed?.error === "string";
  } catch {
    return false;
  }
}
