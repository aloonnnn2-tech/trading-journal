import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AIProvider, AskOptions } from "@/lib/ai-keys/providers";
import { extractJsonObject, generateStructured, parseStructured, StructuredOutputError } from "./parse";

// These tests are the whole reason this app can ask six different providers
// for JSON without native JSON mode. Every case below is something a model
// actually does: fence it, introduce it, chat afterwards, or run out of
// tokens halfway through.

const schema = z.object({ score: z.number(), note: z.string() });

function fakeProvider(replies: string[]): AIProvider & { calls: { prompt: string }[] } {
  const calls: { prompt: string }[] = [];
  let i = 0;
  return {
    name: "groq",
    model: "test-model",
    calls,
    validateKey: async () => true,
    askQuestion: async (_key, _system, question) => {
      calls.push({ prompt: question });
      return replies[i++] ?? "";
    },
  } as AIProvider & { calls: { prompt: string }[] };
}

describe("extractJsonObject", () => {
  it("reads a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("reads through a markdown fence", () => {
    const reply = '```json\n{"a": 1, "b": 2}\n```';
    expect(extractJsonObject(reply)).toBe('{"a": 1, "b": 2}');
  });

  it("ignores a preamble and trailing commentary", () => {
    const reply = 'Sure! Here is the review:\n{"a": 1}\nLet me know if you want more detail.';
    expect(extractJsonObject(reply)).toBe('{"a": 1}');
  });

  it("keeps nested objects whole", () => {
    const reply = '{"outer": {"inner": {"deep": 1}}, "after": 2}';
    expect(extractJsonObject(reply)).toBe(reply);
  });

  it("does not stop at a brace inside a string", () => {
    // A journal note quoted back inside the review. Naive brace counting ends
    // the object here and silently drops every field after it.
    const reply = '{"note": "exit at resistance }", "score": 5}';
    expect(extractJsonObject(reply)).toBe(reply);
  });

  it("does not stop at an escaped quote inside a string", () => {
    const reply = '{"note": "he said \\"sell\\" }", "score": 5}';
    expect(extractJsonObject(reply)).toBe(reply);
  });

  it("returns null for a reply cut off mid-object", () => {
    // Hitting the token ceiling. Reported as a failure rather than repaired by
    // guessing the closing braces -- a completed-by-us object would be missing
    // whole sections with nothing to say so.
    expect(extractJsonObject('{"a": 1, "b": {"c":')).toBeNull();
  });

  it("returns null when there is no object at all", () => {
    expect(extractJsonObject("I can't review this trade.")).toBeNull();
  });
});

describe("parseStructured", () => {
  it("accepts a valid reply", () => {
    const result = parseStructured(schema, '```json\n{"score": 7, "note": "ok"}\n```');
    expect(result).toEqual({ ok: true, value: { score: 7, note: "ok" } });
  });

  it("reports malformed JSON without throwing", () => {
    const result = parseStructured(schema, "{score: 7,}");
    expect(result.ok).toBe(false);
  });

  it("reports a valid object of the wrong shape, naming the field", () => {
    const result = parseStructured(schema, '{"score": "seven", "note": "ok"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("score");
  });
});

describe("generateStructured", () => {
  const base = {
    apiKey: "k",
    systemPrompt: "system",
    userPrompt: "the whole journal context, which is expensive to resend",
    schema,
    schemaHint: "{ score, note }",
    maxTokens: 500,
  };

  it("returns the parsed value without a second call", async () => {
    const provider = fakeProvider(['{"score": 7, "note": "ok"}']);
    const value = await generateStructured({
      ...base,
      provider,
      deadlineAt: Date.now() + 20_000,
    });
    expect(value).toEqual({ score: 7, note: "ok" });
    expect(provider.calls).toHaveLength(1);
  });

  it("repairs one malformed reply", async () => {
    const provider = fakeProvider(["not json at all", '{"score": 7, "note": "ok"}']);
    const value = await generateStructured({
      ...base,
      provider,
      deadlineAt: Date.now() + 20_000,
    });
    expect(value).toEqual({ score: 7, note: "ok" });
    expect(provider.calls).toHaveLength(2);
  });

  it("does not resend the context when repairing", async () => {
    // The whole point of the repair being cheap. Resending the journal would
    // roughly double the request, which on a free tier's per-minute allowance
    // is the difference between a retry and a rate limit.
    const provider = fakeProvider(["not json at all", '{"score": 7, "note": "ok"}']);
    await generateStructured({ ...base, provider, deadlineAt: Date.now() + 20_000 });

    expect(provider.calls[1].prompt).not.toContain("the whole journal context");
    expect(provider.calls[1].prompt).toContain("not json at all");
    expect(provider.calls[1].prompt).toContain("{ score, note }");
  });

  it("gives up rather than repairing a huge reply", async () => {
    const huge = `${"x".repeat(7_000)}`;
    const provider = fakeProvider([huge, '{"score": 7, "note": "ok"}']);

    await expect(
      generateStructured({ ...base, provider, deadlineAt: Date.now() + 20_000 }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(provider.calls).toHaveLength(1);
  });

  it("gives up rather than starting a repair it cannot finish", async () => {
    const provider = fakeProvider(["not json", '{"score": 7, "note": "ok"}']);

    // Deadline already effectively spent: a second round trip would be killed
    // mid-flight by the platform, replacing a specific error with a generic one.
    await expect(
      generateStructured({ ...base, provider, deadlineAt: Date.now() + 1_000 }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(provider.calls).toHaveLength(1);
  });

  it("throws when the repair also fails", async () => {
    const provider = fakeProvider(["not json", "still not json"]);
    await expect(
      generateStructured({ ...base, provider, deadlineAt: Date.now() + 20_000 }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(provider.calls).toHaveLength(2);
  });

  it("passes the caller's token budget to the provider", async () => {
    // Sized per call rather than always spending the default allowance: on a
    // free tier the ceiling is tokens per MINUTE, so headroom left unspent
    // here is headroom the user's next request still has.
    const askQuestion = vi.fn(
      async (_key: string, _system: string, _question: string, _options?: AskOptions) =>
        '{"score": 1, "note": "n"}',
    );
    const provider = {
      name: "groq",
      model: "m",
      validateKey: async () => true,
      askQuestion,
    } as unknown as AIProvider;

    await generateStructured({ ...base, provider, deadlineAt: Date.now() + 20_000 });

    expect(askQuestion.mock.calls[0][3]).toMatchObject({ maxTokens: 500 });
  });
});
