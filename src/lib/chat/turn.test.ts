import { describe, expect, it } from "vitest";
import { runTurn, type TurnContext } from "./turn";
import type { ChatStreamEvent } from "./protocol";
import type { AIProvider, ChatOnceInput, ChatResult } from "@/lib/ai-keys/providers/types";
import { ProviderError } from "@/lib/ai-keys/providers/types";
import { tierPolicyFor } from "@/lib/ai-keys/tier";

// An in-memory ai_messages table behind the same supabase-js surface the
// real queries use, so runTurn's persistence is exercised for real: seq
// allocation, the unique index on (conversation_id, tool_call_id), and the
// content/status updates. Only the calls queries.ts makes are implemented.

interface Row {
  id: string;
  seq: number;
  role: string;
  content: string;
  tool_calls: unknown;
  tool_call_id: string | null;
  tool_name: string | null;
  parts: unknown;
  status: string;
  created_at: string;
}

function fakeDb() {
  const rows: Row[] = [];
  const conv = { message_count: 0, title: null as string | null };
  let n = 0;

  function table(name: string) {
    if (name === "ai_conversations") {
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            Object.assign(conv, patch);
            return { error: null };
          },
        }),
      };
    }
    // ai_messages
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return chain;
      },
      order: () => chain,
      limit: () => Promise.resolve({ data: rows.slice().sort((a, b) => a.seq - b.seq), error: null }),
      insert: (r: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            const seq = r.seq as number;
            if (rows.some((x) => x.seq === seq)) return { data: null, error: { code: "23505" } };
            if (r.tool_call_id && rows.some((x) => x.tool_call_id === r.tool_call_id))
              return { data: null, error: { code: "23505" } };
            n += 1;
            const row: Row = {
              id: `m${n}`,
              seq,
              role: r.role as string,
              content: (r.content as string) ?? "",
              tool_calls: r.tool_calls ?? null,
              tool_call_id: (r.tool_call_id as string) ?? null,
              tool_name: (r.tool_name as string) ?? null,
              parts: null,
              status: (r.status as string) ?? "complete",
              created_at: new Date(n * 1000).toISOString(),
            };
            rows.push(row);
            return { data: row, error: null };
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_k: string, id: string) => {
          const row = rows.find((x) => x.id === id);
          if (row) Object.assign(row, patch);
          return { error: null };
        },
      }),
    };
    return chain;
  }

  return { rows, conv, supabase: { from: table } as never };
}

/** A provider whose chatStream replays a script of results, one per call. */
function scripted(script: ChatResult[], opts: { streamText?: boolean } = {}): AIProvider & { seen: ChatOnceInput[] } {
  const seen: ChatOnceInput[] = [];
  let i = 0;
  const p = {
    name: "groq" as const,
    model: "m",
    seen,
    validateKey: async () => true,
    askQuestion: async () => "",
    chatStream: async (_k: string, input: ChatOnceInput, onText: (d: string) => void) => {
      seen.push(input);
      const r = script[Math.min(i++, script.length - 1)];
      if (r instanceof Error) throw r;
      if (r.kind === "text" && opts.streamText !== false) {
        for (const ch of r.text.split(" ")) onText(ch + " ");
      }
      return r;
    },
  };
  return p as unknown as AIProvider & { seen: ChatOnceInput[] };
}

function ctxFor(db: ReturnType<typeof fakeDb>, provider: AIProvider, extra: Partial<TurnContext> = {}): TurnContext {
  return {
    supabase: db.supabase,
    userId: "u1",
    conversationId: "c1",
    provider,
    apiKey: "k",
    policy: tierPolicyFor("groq"),
    system: "sys",
    tools: [{ name: "compute_stats", description: "d", parameters: {} }],
    execute: async (call) => JSON.stringify({ trades: 10, called: call.name }),
    maxTokens: 500,
    deadline: Date.now() + 20_000,
    ...extra,
  };
}

async function run(ctx: TurnContext) {
  const events: ChatStreamEvent[] = [];
  await runTurn(ctx, (e) => events.push(e));
  return events;
}

const types = (evs: ChatStreamEvent[]) => evs.map((e) => e.type);

describe("runTurn", () => {
  it("send: persists the user message, streams the answer, ends idle", async () => {
    const db = fakeDb();
    const events = await run(ctxFor(db, scripted([{ kind: "text", text: "Hello there" }]), { newMessage: "hi" }));

    expect(types(events)).toEqual(["message_start", "text_delta", "text_delta", "message_end", "done"]);
    expect(events.at(-1)).toMatchObject({ type: "done", next: "idle", round: 0 });
    expect(db.rows.map((r) => [r.role, r.status])).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
    ]);
    expect(db.rows[1].content).toBe("Hello there");
    expect(db.conv.title).toBe("hi");
  });

  it("tool round: persists the call and each result, ends with continue", async () => {
    const db = fakeDb();
    const provider = scripted([
      { kind: "tool_calls", calls: [{ id: "c1", name: "compute_stats", args: {} }], assistant: { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "compute_stats", args: {} }] } },
    ]);
    const events = await run(ctxFor(db, provider, { newMessage: "stats?" }));

    expect(types(events)).toEqual(["message_start", "tool_call", "message_end", "tool_result", "done"]);
    expect(events.at(-1)).toMatchObject({ type: "done", next: "continue", round: 1 });
    const toolRow = db.rows.find((r) => r.role === "tool");
    expect(toolRow?.tool_call_id).toBe("c1");
    expect(toolRow?.content).toContain('"trades":10');
  });

  it("continue: the next turn sees the tool result and produces the answer", async () => {
    const db = fakeDb();
    const calls = [{ id: "c1", name: "compute_stats", args: {} }];
    const provider = scripted([
      { kind: "tool_calls", calls, assistant: { role: "assistant", content: "", toolCalls: calls } },
      { kind: "text", text: "Ten trades." },
    ]);
    await run(ctxFor(db, provider, { newMessage: "stats?" }));
    const events = await run(ctxFor(db, provider)); // mode: continue

    expect(events.at(-1)).toMatchObject({ type: "done", next: "idle" });
    // The second model call received the tool result in its transcript.
    const second = provider.seen[1];
    expect(second.messages.some((m) => m.role === "tool" && m.toolCallId === "c1")).toBe(true);
  });

  it("defers tool execution when the deadline is near, and re-enters next turn", async () => {
    const db = fakeDb();
    const calls = [{ id: "c1", name: "compute_stats", args: {} }];
    const provider = scripted([
      { kind: "tool_calls", calls, assistant: { role: "assistant", content: "", toolCalls: calls } },
      { kind: "text", text: "done" },
    ]);
    // Enough time for the model call, not enough for tools afterwards.
    const first = await run(ctxFor(db, provider, { newMessage: "q", deadline: Date.now() + 3_500 }));
    expect(first.at(-1)).toMatchObject({ type: "done", next: "continue" });
    expect(db.rows.some((r) => r.role === "tool")).toBe(false); // not run yet

    // Re-entry: the next turn runs the pending call BEFORE calling the model.
    const second = await run(ctxFor(db, provider));
    expect(db.rows.some((r) => r.role === "tool" && r.tool_call_id === "c1")).toBe(true);
    expect(types(second)[0]).toBe("tool_result");
    expect(second.at(-1)).toMatchObject({ type: "done", next: "idle" });
  });

  it("never stores the same tool result twice", async () => {
    const db = fakeDb();
    const calls = [{ id: "c1", name: "compute_stats", args: {} }];
    const provider = scripted([
      { kind: "tool_calls", calls, assistant: { role: "assistant", content: "", toolCalls: calls } },
      { kind: "text", text: "x" },
    ]);
    await run(ctxFor(db, provider, { newMessage: "q", deadline: Date.now() + 3_500 }));
    await run(ctxFor(db, provider));
    await run(ctxFor(db, provider)); // a spurious extra continue
    expect(db.rows.filter((r) => r.tool_call_id === "c1")).toHaveLength(1);
  });

  it("keeps partial text as interrupted when the model call fails", async () => {
    const db = fakeDb();
    const provider = {
      ...scripted([]),
      chatStream: async (_k: string, _i: ChatOnceInput, onText: (d: string) => void) => {
        onText("half ");
        throw new ProviderError("unavailable", "429", 12);
      },
    } as unknown as AIProvider;
    const events = await run(ctxFor(db, provider, { newMessage: "q" }));

    const a = db.rows.find((r) => r.role === "assistant");
    expect(a?.status).toBe("interrupted");
    expect(a?.content).toBe("half ");
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "unavailable", retryAfterSeconds: 12 });
    expect(events.find((e) => e.type === "message_end")).toMatchObject({ stopReason: "interrupted" });
  });

  it("still titles and counts the conversation when the first turn is interrupted", async () => {
    // A Stop on the very first answer used to leave message_count at 0 and
    // no title -- hidden from the list entirely.
    const db = fakeDb();
    const provider = {
      ...scripted([]),
      chatStream: async (_k: string, _i: ChatOnceInput, onText: (d: string) => void) => {
        onText("partial");
        throw new ProviderError("unavailable", "aborted");
      },
    } as unknown as AIProvider;
    await run(ctxFor(db, provider, { newMessage: "how am I doing this month?" }));

    expect(db.conv.message_count).toBe(2);
    expect(db.conv.title).toBe("how am I doing this month?");
  });

  it("withholds tools and tells the model to answer at the hard round ceiling", async () => {
    const db = fakeDb();
    // Pre-seed 25 tool rounds since the last user message.
    let seq = 0;
    db.rows.push({ id: "u", seq: seq++, role: "user", content: "q", tool_calls: null, tool_call_id: null, tool_name: null, parts: null, status: "complete", created_at: "" });
    for (let i = 0; i < 25; i++) {
      const id = `c${i}`;
      db.rows.push({ id: `a${i}`, seq: seq++, role: "assistant", content: "", tool_calls: [{ id, name: "compute_stats", args: {} }], tool_call_id: null, tool_name: null, parts: null, status: "complete", created_at: "" });
      db.rows.push({ id: `t${i}`, seq: seq++, role: "tool", content: "{}", tool_calls: null, tool_call_id: id, tool_name: "compute_stats", parts: null, status: "complete", created_at: "" });
    }
    const provider = scripted([{ kind: "text", text: "final" }]);
    await run(ctxFor(db, provider));

    const input = provider.seen[0];
    expect(input.tools).toEqual([]);
    expect(input.messages.at(-1)?.content).toContain("Do not request any more tools");
  });

  it("refuses a conversation at the message cap", async () => {
    const db = fakeDb();
    for (let i = 0; i < 400; i++) {
      db.rows.push({ id: `r${i}`, seq: i, role: i % 2 ? "assistant" : "user", content: "x", tool_calls: null, tool_call_id: null, tool_name: null, parts: null, status: "complete", created_at: "" });
    }
    const events = await run(ctxFor(db, scripted([{ kind: "text", text: "no" }]), { newMessage: "more" }));
    expect(events).toEqual([expect.objectContaining({ type: "error", code: "too_long" })]);
  });

  it("completes a stranded tool round BEFORE appending a new question", async () => {
    // Stop during the lookups, then ask something else. The pending calls
    // must get their results before the new user row lands, or the transcript
    // has assistant(tool_calls) → user with no results between -- which every
    // provider rejects, on this and every later turn.
    const db = fakeDb();
    const calls = [{ id: "c1", name: "compute_stats", args: {} }];
    const provider = scripted([
      { kind: "tool_calls", calls, assistant: { role: "assistant", content: "", toolCalls: calls } },
      { kind: "text", text: "answer to q2" },
    ]);
    await run(ctxFor(db, provider, { newMessage: "q1", deadline: Date.now() + 3_500 })); // tools deferred
    const events = await run(ctxFor(db, provider, { newMessage: "q2" }));

    const roles = db.rows.map((r) => r.role);
    expect(roles).toEqual(["user", "assistant", "tool", "user", "assistant"]);
    // The old round's result is bookkeeping for the new question, not its activity.
    expect(types(events)).not.toContain("tool_result");
    expect(events.at(-1)).toMatchObject({ type: "done", next: "idle" });
    // And the model saw a well-formed transcript: call, result, then the new question.
    const seen = provider.seen[1].messages.map((m) => m.role);
    expect(seen).toEqual(["user", "assistant", "tool", "user"]);
  });

  it("writes nothing for a round the user stopped during the tools phase", async () => {
    const db = fakeDb();
    const calls = [{ id: "c1", name: "compute_stats", args: {} }];
    const provider = scripted([{ kind: "tool_calls", calls, assistant: { role: "assistant", content: "", toolCalls: calls } }]);
    const controller = new AbortController();
    const events = await run(
      ctxFor(db, provider, {
        newMessage: "q",
        signal: controller.signal,
        execute: () =>
          new Promise((resolve) => {
            controller.abort(); // Stop arrives while the tool is running
            setTimeout(() => resolve("{}"), 50);
          }),
      }),
    );

    // No tool row: the next turn re-enters and runs the call for real,
    // instead of the model being told the lookup "stopped".
    expect(db.rows.some((r) => r.role === "tool")).toBe(false);
    expect(types(events)).not.toContain("tool_result");
    expect(types(events)).not.toContain("done");
    // The conversation is still counted and titled.
    expect(db.conv.message_count).toBe(2);
  });

  it("does not overwrite a title the conversation already has", async () => {
    const db = fakeDb();
    db.conv.title = "My renamed chat";
    await run(ctxFor(db, scripted([{ kind: "text", text: "ok" }]), { newMessage: "a new question", hasTitle: true }));
    expect(db.conv.title).toBe("My renamed chat");
  });

  it("reports conversation_busy when another turn owns the next seq", async () => {
    const db = fakeDb();
    // A concurrent turn grabs the seq right before our assistant row lands.
    const inner = db.supabase as unknown as { from: (n: string) => Record<string, unknown> };
    const supabase = {
      from: (name: string) => {
        const t = inner.from(name);
        if (name === "ai_messages") {
          const insert = t.insert as (r: Record<string, unknown>) => unknown;
          t.insert = (r: Record<string, unknown>) => {
            if (r.role === "assistant") {
              db.rows.push({ id: "theirs", seq: r.seq as number, role: "assistant", content: "", tool_calls: null, tool_call_id: null, tool_name: null, parts: null, status: "complete", created_at: "" });
            }
            return insert(r);
          };
        }
        return t;
      },
    } as never;
    const events = await run(ctxFor(db, scripted([{ kind: "text", text: "late" }]), { newMessage: "mine", supabase }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "conversation_busy" });
    // Ours was never written; theirs stands.
    expect(db.rows.filter((r) => r.role === "assistant")).toHaveLength(1);
  });

  it("refuses a continue when the last row is a finished answer", async () => {
    // Otherwise a scripted client could call the model again and again with
    // no new input -- on the user's own key, but with no ceiling except the
    // per-turn rate limit.
    const db = fakeDb();
    const provider = scripted([{ kind: "text", text: "done" }]);
    await run(ctxFor(db, provider, { newMessage: "q" }));
    const events = await run(ctxFor(db, provider)); // mode: continue, nothing pending
    expect(events).toEqual([expect.objectContaining({ type: "error", code: "nothing_pending" })]);
    expect(provider.seen).toHaveLength(1);
  });

  it("caps an oversized tool result instead of truncating its JSON", async () => {
    const db = fakeDb();
    const calls = [{ id: "c1", name: "compute_stats", args: {} }];
    const provider = scripted([{ kind: "tool_calls", calls, assistant: { role: "assistant", content: "", toolCalls: calls } }]);
    await run(ctxFor(db, provider, { newMessage: "q", execute: async () => JSON.stringify({ big: "x".repeat(10_000) }) }));

    const toolRow = db.rows.find((r) => r.role === "tool")!;
    expect(JSON.parse(toolRow.content)).toMatchObject({ error: "result too large" });
  });
});
