import type { z } from "zod";
import { ASK_TIMEOUT_MS, type AIProvider } from "@/lib/ai-keys/providers";

// Getting structured output back from six different providers.
//
// **Native JSON mode is deliberately not used.** Each provider spells it
// differently (`response_format`, `responseMimeType`, tool-calling), support
// varies by model rather than by provider, and the models this app leans on
// hardest are exactly the ones where it is least reliable -- the free-tier
// options (Groq's reasoning model, OpenRouter's `:free` variants) that make
// this feature usable without a paid account. Wiring four request shapes for
// a guarantee that wouldn't hold on half of them buys nothing.
//
// So: ask for JSON in the prompt, then be genuinely good at reading the reply.
// One transport, six providers, and the validation below is what turns
// "usually JSON" into "JSON or a clear error".

/** Thrown when the model's reply could not be read as the expected shape. */
export class StructuredOutputError extends Error {
  /** Detail for server logs. Never returned to the client -- it quotes the
   *  model's reply, which was generated from the user's journal. */
  readonly detail: string;

  constructor(detail: string) {
    super("The model did not return a usable review.");
    this.name = "StructuredOutputError";
    this.detail = detail;
  }
}

/**
 * Pulls the first complete JSON object out of a model reply.
 *
 * Models wrap JSON in ``` fences, prefix it with "Here's the review:", and
 * append commentary after the closing brace -- often all three at once. Rather
 * than stripping each habit individually, this scans for the first balanced
 * `{...}` and ignores everything around it.
 *
 * Brace counting is string-aware: a `}` inside a journal note ("closed at
 * resistance }" or, more realistically, any quoted text containing a brace)
 * would otherwise end the object early and produce a truncated parse. Escapes
 * are honoured so a `\"` inside a string doesn't look like the string ending.
 */
export function extractJsonObject(reply: string): string | null {
  const start = reply.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < reply.length; i++) {
    const ch = reply[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return reply.slice(start, i + 1);
    }
  }

  // Unbalanced: the reply was cut off mid-object, which in practice means the
  // token ceiling was hit. Reported as a parse failure rather than repaired by
  // guessing at the missing braces -- a completed-by-us object would be
  // missing whole sections with nothing to say so.
  return null;
}

/**
 * Reads a model reply as `schema`. Returns the error text on failure rather
 * than throwing, because the caller uses it to build the repair prompt.
 */
export function parseStructured<T>(
  schema: z.ZodType<T>,
  reply: string,
): { ok: true; value: T } | { ok: false; error: string } {
  const json = extractJsonObject(reply);
  if (json === null) {
    return { ok: false, error: "No complete JSON object found in the reply." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err instanceof Error ? err.message : err}` };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `JSON did not match the required shape — ${issues}` };
  }
  return { ok: true, value: result.data };
}

/**
 * A malformed reply longer than this is not worth repairing.
 *
 * The repair call has to resend the broken reply, so its cost scales with the
 * reply's length. Past a few thousand characters the retry costs about as
 * much as the original request, which on a free tier's per-minute token
 * allowance is the difference between "one retry" and "rate-limited for the
 * next minute". A reply this long that still doesn't parse is also almost
 * always a runaway model rather than a stray fence -- the case least likely
 * to be fixed by asking again.
 */
const REPAIR_MAX_REPLY_CHARS = 6_000;

/** Below this much time left, there isn't room for another provider round
 *  trip before the platform kills the request. */
const REPAIR_MIN_REMAINING_MS = 6_000;

/** Bounded because the repair only has to re-emit the same content as JSON --
 *  it is not writing anything new. */
const REPAIR_MAX_TOKENS = 1_500;

const REPAIR_SYSTEM_PROMPT = [
  "You fix malformed JSON. You are given a document that was supposed to be a",
  "single JSON object, and the error it produced.",
  "",
  "Return the corrected JSON object and nothing else: no explanation, no",
  "markdown fences, no text before or after it.",
  "",
  "Preserve the original content exactly. Do not add findings, do not remove",
  "findings, and do not change any number. You are correcting the format only.",
].join("\n");

/**
 * Asks the provider for a structured answer, repairing one malformed reply.
 *
 * The repair sends **only** the broken reply, the expected shape, and the
 * error -- never the journal context again. "Fix this JSON" is a
 * self-contained task, so the retry costs a few hundred tokens instead of
 * doubling the request. On a free tier that is the whole difference between a
 * retry that works and a rate limit the user experiences as a random failure.
 *
 * Both budgets are checked before retrying: the wall clock (so the second call
 * can't push the request past the platform's ceiling, which would replace a
 * specific error with the platform's generic one) and the size of what would
 * have to be resent.
 */
export async function generateStructured<T>({
  provider,
  apiKey,
  systemPrompt,
  userPrompt,
  schema,
  schemaHint,
  maxTokens,
  deadlineAt,
}: {
  provider: AIProvider;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  /** Compact description of the expected shape, reused in the repair prompt. */
  schemaHint: string;
  maxTokens: number;
  /** Epoch ms by which this whole operation must be finished. */
  deadlineAt: number;
}): Promise<T> {
  function remainingMs(): number {
    return deadlineAt - Date.now();
  }

  const reply = await provider.askQuestion(apiKey, systemPrompt, userPrompt, {
    maxTokens,
    timeoutMs: Math.min(ASK_TIMEOUT_MS, Math.max(1_000, remainingMs())),
  });

  const first = parseStructured(schema, reply);
  if (first.ok) return first.value;

  if (reply.length > REPAIR_MAX_REPLY_CHARS || remainingMs() < REPAIR_MIN_REMAINING_MS) {
    throw new StructuredOutputError(
      `unrepairable (${reply.length} chars, ${remainingMs()}ms left): ${first.error}`,
    );
  }

  const repaired = await provider.askQuestion(
    apiKey,
    REPAIR_SYSTEM_PROMPT,
    [
      `The error was: ${first.error}`,
      "",
      "The JSON object must have this shape:",
      schemaHint,
      "",
      "Here is the document to fix:",
      reply,
    ].join("\n"),
    {
      maxTokens: REPAIR_MAX_TOKENS,
      timeoutMs: Math.min(ASK_TIMEOUT_MS, Math.max(1_000, remainingMs())),
    },
  );

  const second = parseStructured(schema, repaired);
  if (second.ok) return second.value;

  throw new StructuredOutputError(`repair failed: ${first.error} | then: ${second.error}`);
}
