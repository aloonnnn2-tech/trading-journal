import { describe, expect, it } from "vitest";
import { foldMessages } from "./fold";
import { buildModelMessages } from "./trim";
import type { MessageRow } from "./queries";
import { tierPolicyFor } from "@/lib/ai-keys/tier";

let seq = 0;
function row(partial: Partial<MessageRow> & Pick<MessageRow, "role">): MessageRow {
  seq += 1;
  return {
    id: `m${seq}`,
    seq,
    content: "",
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    parts: null,
    status: "complete",
    created_at: new Date(seq * 1000).toISOString(),
    ...partial,
  };
}

const user = (content: string) => row({ role: "user", content });
const asks = (id: string, name: string) =>
  row({ role: "assistant", content: "", tool_calls: [{ id, name, args: {} }] });
const tool = (id: string, name: string, content = "{}") =>
  row({ role: "tool", content, tool_call_id: id, tool_name: name });
const answer = (content: string, status: MessageRow["status"] = "complete") =>
  row({ role: "assistant", content, status });

describe("foldMessages", () => {
  it("groups a user message with its tool activity and final answer", () => {
    const turns = foldMessages([
      user("win rate by weekday?"),
      asks("c1", "compute_stats"),
      tool("c1", "compute_stats", '{"trades":10}'),
      answer("Mondays are best."),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].user.content).toBe("win rate by weekday?");
    expect(turns[0].activity.map((a) => a.label)).toEqual(["computed your stats"]);
    expect(turns[0].answer?.content).toBe("Mondays are best.");
  });

  it("does not show an assistant tool-call row as an answer", () => {
    const turns = foldMessages([user("q"), asks("c1", "query_trades")]);
    expect(turns[0].answer).toBeUndefined();
    expect(turns[0].activity).toHaveLength(0); // the tool hasn't run yet
  });

  it("marks a tool result that reported an error", () => {
    const turns = foldMessages([user("q"), asks("c1", "get_trade"), tool("c1", "get_trade", '{"error":"not found"}')]);
    expect(turns[0].activity[0].ok).toBe(false);
  });

  it("keeps an interrupted answer, labelled as such", () => {
    const turns = foldMessages([user("q"), answer("half an ans", "interrupted")]);
    expect(turns[0].answer?.status).toBe("interrupted");
  });

  it("starts a new turn at every user message", () => {
    const turns = foldMessages([user("a"), answer("1"), user("b"), answer("2")]);
    expect(turns.map((t) => t.answer?.content)).toEqual(["1", "2"]);
  });
});

describe("buildModelMessages", () => {
  const paid = tierPolicyFor("openai");
  const free = tierPolicyFor("groq");

  it("converts rows to provider messages, pairing tool rows with their call", () => {
    const msgs = buildModelMessages(
      [user("q"), asks("c1", "compute_stats"), tool("c1", "compute_stats", '{"x":1}'), answer("a")],
      paid,
    );
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(msgs[1].toolCalls?.[0].id).toBe("c1");
    expect(msgs[2].toolCallId).toBe("c1");
    expect(msgs[2].toolName).toBe("compute_stats");
  });

  it("never sends an interrupted or errored row", () => {
    const msgs = buildModelMessages([user("q"), answer("partial", "interrupted"), user("again")], paid);
    expect(msgs.map((m) => m.content)).toEqual(["q\n\nagain"]);
  });

  it("blanks old tool bodies before dropping anything", () => {
    const rows = [
      user("q1"),
      asks("c1", "compute_stats"),
      tool("c1", "compute_stats", "OLD_BODY"),
      answer("a1"),
      user("q2"),
      asks("c2", "compute_stats"),
      tool("c2", "compute_stats", "NEW_BODY"),
      answer("a2"),
      user("q3"),
    ];
    // free tier keeps 1 tool round's bodies
    const msgs = buildModelMessages(rows, free);
    const tools = msgs.filter((m) => m.role === "tool").map((m) => m.content);
    expect(tools[0]).toContain("omitted");
    expect(tools[1]).toBe("NEW_BODY");
  });

  it("drops whole rounds oldest-first to fit the budget, never orphaning a tool row", () => {
    const big = "x".repeat(3_000);
    const rows = [
      user("q1"),
      asks("c1", "query_trades"),
      tool("c1", "query_trades", big),
      answer(big),
      user("q2"),
      asks("c2", "query_trades"),
      tool("c2", "query_trades", big),
      answer(big),
      user("q3 latest"),
    ];
    const msgs = buildModelMessages(rows, { ...free, historyBudgetChars: 4_000 });

    // Every tool row must be preceded (somewhere before it) by the assistant
    // call that owns it -- providers 400 otherwise.
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== "tool") continue;
      const owner = msgs.slice(0, i).find((m) => m.toolCalls?.some((c) => c.id === msgs[i].toolCallId));
      expect(owner, `tool row ${msgs[i].toolCallId} has its call`).toBeDefined();
    }
    // The latest question is always kept.
    expect(msgs[msgs.length - 1].content).toBe("q3 latest");
    // The transcript opens with a user message.
    expect(msgs[0].role).toBe("user");
  });

  it("merges adjacent user rows into one message", () => {
    const msgs = buildModelMessages([user("first"), user("second")], paid);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("first\n\nsecond");
  });

  it("never trims the current question, even when it alone exceeds the budget", () => {
    // The first version dropped rounds "never the final one" -- but the final
    // round is the latest TOOL round, not the question, so a question whose
    // own lookups exceeded the budget lost the question itself and the
    // earlier results the answer needed.
    const big = "x".repeat(5_000);
    const rows = [
      user("old q"),
      answer("old a"),
      user("the question"),
      asks("c1", "compute_stats"),
      tool("c1", "compute_stats", big),
      asks("c2", "query_trades"),
      tool("c2", "query_trades", big),
    ];
    const msgs = buildModelMessages(rows, { ...free, historyBudgetChars: 2_000 });
    expect(msgs[0]).toMatchObject({ role: "user", content: "the question" });
    // Both of this question's tool bodies are intact -- the answer has to
    // quote them -- even on a tier that keeps only one round's bodies.
    expect(msgs.filter((m) => m.role === "tool").map((m) => m.content)).toEqual([big, big]);
  });

  it("keeps the current question's tool bodies and blanks only earlier questions'", () => {
    const rows = [
      user("q1"),
      asks("c1", "compute_stats"),
      tool("c1", "compute_stats", "Q1_BODY"),
      answer("a1"),
      user("q2"),
      asks("c2", "compute_stats"),
      tool("c2", "compute_stats", "Q2_FIRST"),
      asks("c3", "query_trades"),
      tool("c3", "query_trades", "Q2_SECOND"),
    ];
    const tools = buildModelMessages(rows, free).filter((m) => m.role === "tool").map((m) => m.content);
    expect(tools).toEqual([expect.stringContaining("omitted"), "Q2_FIRST", "Q2_SECOND"]);
  });

  it("leaves out a tool round whose results are incomplete, and a tool row with no call", () => {
    const rows = [
      user("q"),
      asks("c1", "compute_stats"),
      // c1 never got its result (a stranded turn); a stray tool row follows.
      tool("zzz", "query_trades", "{}"),
      answer("a"),
      user("q2"),
    ];
    const msgs = buildModelMessages(rows, paid);
    expect(msgs.some((m) => m.role === "tool")).toBe(false);
    expect(msgs.some((m) => m.toolCalls)).toBe(false);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});
