import type { ChatMessage } from "@/lib/ai-keys/providers/types";
import type { TierPolicy } from "@/lib/ai-keys/tier";
import type { MessageRow } from "./queries";

/**
 * Turns stored rows into the transcript the model sees, within a budget.
 *
 * Three things this must get right that the old `trimHistory` never had to:
 *
 * 1. **Tool rows travel with their assistant call.** Anthropic and OpenAI
 *    both reject a `tool` message whose call is not in the transcript, and an
 *    assistant tool-call message with no results after it. So the unit of
 *    trimming is a ROUND -- one user message, or one assistant tool-call plus
 *    all of its tool rows -- never a single row. A round whose results are
 *    incomplete (a stranded turn that re-entry has not caught up with yet) is
 *    left out entirely rather than sent broken.
 * 2. **The current question is never trimmed.** Everything from the most
 *    recent user message onward -- the question and the tool rounds answering
 *    it -- is sent whole, bodies included, because that is the data the
 *    answer must quote. Only EARLIER questions are candidates for cutting.
 * 3. **Old tool results are the cheapest thing to drop.** A 6 KB stats blob
 *    from four questions ago is rarely what the next answer needs, but the
 *    assistant's summary of it usually is. So before any round is dropped,
 *    tool bodies of earlier questions beyond `keepToolBodiesRounds` are
 *    blanked to a stub; the structure survives, the tokens do not.
 *
 * Rows with status "interrupted" or "error" are skipped: a half answer the
 * user never saw as complete must not become something the model continues
 * from as if it had said it.
 */
export function buildModelMessages(rows: MessageRow[], policy: TierPolicy): ChatMessage[] {
  const rounds = groupRounds(rows);
  if (rounds.length === 0) return [];

  // Everything from the last user round on is the current question.
  let lastUser = rounds.length - 1;
  while (lastUser > 0 && rounds[lastUser][0].role !== "user") lastUser -= 1;

  // Blank old tool bodies. Tool rounds are counted from the end, the current
  // question's included, and a round of an EARLIER question keeps its body
  // only while the count is within the policy. So on a tier that keeps one
  // round: a follow-up's first model call still sees the previous question's
  // latest results (what "which of those…" refers to), and as soon as the
  // follow-up makes its own lookup, the old body goes.
  let toolRoundsSeen = 0;
  const converted: ChatMessage[][] = [];
  for (let i = rounds.length - 1; i >= 0; i--) {
    const round = rounds[i];
    const current = i >= lastUser;
    const isToolRound = round[0].role === "assistant" && (round[0].tool_calls?.length ?? 0) > 0;
    if (isToolRound) toolRoundsSeen += 1;
    const blankBodies = isToolRound && !current && toolRoundsSeen > policy.keepToolBodiesRounds;
    converted.unshift(round.map((r) => toChatMessage(r, blankBodies)));
  }

  // Fit to budget by dropping whole earlier rounds, oldest first. The
  // current question's rounds are never candidates, so a single oversized
  // question goes over budget rather than losing its own results.
  let total = converted.reduce((n, r) => n + cost(r), 0);
  let start = 0;
  while (start < lastUser && total > policy.historyBudgetChars) {
    total -= cost(converted[start]);
    start += 1;
  }

  // Providers require the transcript to open with a user message. If the
  // cut landed on a tool round, walk forward to the next user round.
  while (start < lastUser && converted[start][0].role !== "user") start += 1;

  return mergeAdjacentUsers(converted.slice(start).flat());
}

/**
 * Groups complete rows into rounds and drops what cannot be sent: a tool
 * row with no call to answer, and an assistant tool-call round that is
 * missing any of its results.
 */
function groupRounds(rows: MessageRow[]): MessageRow[][] {
  const rounds: MessageRow[][] = [];
  for (const row of rows) {
    if (row.status !== "complete") continue;
    if (row.role === "tool") {
      const last = rounds[rounds.length - 1];
      const expected = last?.[0].role === "assistant" ? last[0].tool_calls : null;
      // Only a result for a call in the open round belongs to it.
      if (expected && row.tool_call_id && expected.some((c) => c.id === row.tool_call_id)) last.push(row);
      continue;
    }
    rounds.push([row]);
  }
  return rounds.filter((round) => {
    const head = round[0];
    if (head.role !== "assistant" || !head.tool_calls?.length) return true;
    const answered = new Set(round.slice(1).map((r) => r.tool_call_id));
    return head.tool_calls.every((c) => answered.has(c.id));
  });
}

const OMITTED = '{"omitted":"earlier result, no longer needed"}';

function toChatMessage(row: MessageRow, blankToolBody: boolean): ChatMessage {
  if (row.role === "tool") {
    return {
      role: "tool",
      content: blankToolBody ? OMITTED : row.content,
      toolCallId: row.tool_call_id ?? undefined,
      toolName: row.tool_name ?? undefined,
    };
  }
  if (row.role === "assistant") {
    return {
      role: "assistant",
      content: row.content,
      toolCalls: row.tool_calls && row.tool_calls.length > 0 ? row.tool_calls : undefined,
    };
  }
  return { role: "user", content: row.content };
}

function cost(round: ChatMessage[]): number {
  return round.reduce((n, m) => n + m.content.length + 1, 0);
}

/**
 * Two user rows in a row (a question followed by a "[Journal update]" note
 * in a later phase, or a question after a dropped round) become one
 * message, because every provider requires strict user/assistant alternation.
 */
function mergeAdjacentUsers(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === "user" && m.role === "user") {
      prev.content = `${prev.content}\n\n${m.content}`;
    } else {
      out.push({ ...m });
    }
  }
  return out;
}
