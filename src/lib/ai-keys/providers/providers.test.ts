import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider, providerModel } from "./index";
import { ProviderError, failureFromStatus } from "./types";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, PROVIDER_MODELS, PROVIDER_LABELS } from "../types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(response: { status?: number; body?: unknown; text?: string }) {
  const status = response.status ?? 200;
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response.body ?? {},
    text: async () => response.text ?? JSON.stringify(response.body ?? {}),
  })) as unknown as typeof fetch;
}

describe("failureFromStatus", () => {
  it("classifies rejected credentials", () => {
    expect(failureFromStatus(401)).toBe("invalid_key");
    expect(failureFromStatus(403)).toBe("invalid_key");
  });

  it("classifies retryable conditions", () => {
    // A 429 here is the user's own quota or rate limit, not ours -- still
    // "try again later" rather than "your key is broken".
    expect(failureFromStatus(429)).toBe("unavailable");
    for (const status of [500, 502, 503, 529]) {
      expect(failureFromStatus(status)).toBe("unavailable");
    }
  });

  it("does not blame the key for a generic 400", () => {
    // A malformed request is our bug. Reporting it as a bad key would send
    // the user off to regenerate a perfectly good credential.
    expect(failureFromStatus(400)).toBe("failed");
    expect(failureFromStatus(404)).toBe("failed");
  });
});

describe("provider registry", () => {
  it("resolves every provider the schema and migration allow", () => {
    for (const name of AI_PROVIDERS) {
      const provider = getProvider(name);
      expect(provider.name).toBe(name);
      expect(typeof provider.validateKey).toBe("function");
      expect(typeof provider.askQuestion).toBe("function");
      expect(providerModel(name)).toBeTruthy();
    }
  });
});

describe("validateKey", () => {
  it("returns true when the provider accepts the credentials", async () => {
    for (const name of AI_PROVIDERS) {
      stubFetch({ status: 200, body: { data: [] } });
      await expect(getProvider(name).validateKey("test-key")).resolves.toBe(true);
    }
  });

  it("returns false -- not an error -- when the provider rejects the key", async () => {
    // False means "we got a verdict and it was no", which is what lets POST
    // answer with a clear 400 instead of a 500.
    for (const name of AI_PROVIDERS) {
      stubFetch({ status: 401, text: "unauthorized" });
      await expect(getProvider(name).validateKey("bad-key")).resolves.toBe(false);
    }
  });

  it("throws unavailable when the provider never gives a verdict", async () => {
    // Refusing to save a valid key because the provider was briefly down
    // would be its own dead end, so this must not read as "bad key".
    for (const name of AI_PROVIDERS) {
      stubFetch({ status: 503, text: "service unavailable" });
      await expect(getProvider(name).validateKey("test-key")).rejects.toMatchObject({
        failure: "unavailable",
      });
    }
  });

  it("treats Google's 400 API_KEY_INVALID as a rejected key", async () => {
    // Google reports a bad key as 400, unlike the 401 the other two use.
    stubFetch({ status: 400, text: '{"error":{"message":"API key not valid"}}' });
    await expect(getProvider("google").validateKey("bad")).resolves.toBe(false);
  });

  it("does not treat an unrelated Google 400 as a rejected key", async () => {
    stubFetch({ status: 400, text: '{"error":{"message":"Invalid JSON payload"}}' });
    await expect(getProvider("google").validateKey("good")).rejects.toBeInstanceOf(ProviderError);
  });

  it("reports a network failure as unavailable rather than crashing", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(getProvider("openai").validateKey("k")).rejects.toMatchObject({
      failure: "unavailable",
    });
  });
});

describe("askQuestion", () => {
  it("extracts the answer from each provider's response shape", async () => {
    stubFetch({ body: { choices: [{ message: { content: "  openai answer  " } }] } });
    await expect(getProvider("openai").askQuestion("k", "sys", "q")).resolves.toBe("openai answer");

    stubFetch({ body: { content: [{ type: "text", text: "anthropic answer" }] } });
    await expect(getProvider("anthropic").askQuestion("k", "sys", "q")).resolves.toBe(
      "anthropic answer",
    );

    stubFetch({ body: { candidates: [{ content: { parts: [{ text: "google answer" }] } }] } });
    await expect(getProvider("google").askQuestion("k", "sys", "q")).resolves.toBe("google answer");
  });

  it("skips Anthropic thinking blocks instead of returning one as the answer", async () => {
    // With thinking on, content[0] is a thinking block whose text is empty by
    // default. Indexing [0] would return nothing and look like a failure.
    stubFetch({
      body: {
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "the real answer" },
        ],
      },
    });
    await expect(getProvider("anthropic").askQuestion("k", "sys", "q")).resolves.toBe(
      "the real answer",
    );
  });

  it("treats an Anthropic refusal as a failure rather than an empty answer", async () => {
    stubFetch({
      body: { stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] },
    });
    await expect(getProvider("anthropic").askQuestion("k", "sys", "q")).rejects.toMatchObject({
      failure: "failed",
    });
  });

  it("treats a Google blocked prompt as a failure rather than an empty answer", async () => {
    stubFetch({ body: { promptFeedback: { blockReason: "SAFETY" }, candidates: [] } });
    await expect(getProvider("google").askQuestion("k", "sys", "q")).rejects.toMatchObject({
      failure: "failed",
    });
  });

  it("maps a mid-conversation 401 to invalid_key on every provider", async () => {
    // The key was valid at save time but has since been revoked.
    for (const name of AI_PROVIDERS) {
      stubFetch({ status: 401, text: "unauthorized" });
      await expect(getProvider(name).askQuestion("k", "sys", "q")).rejects.toMatchObject({
        failure: "invalid_key",
      });
    }
  });

  it("maps rate limits to unavailable on every provider", async () => {
    for (const name of AI_PROVIDERS) {
      stubFetch({ status: 429, text: "rate limited" });
      await expect(getProvider(name).askQuestion("k", "sys", "q")).rejects.toMatchObject({
        failure: "unavailable",
      });
    }
  });

  it("rejects an empty answer rather than returning blank text", async () => {
    stubFetch({ body: { choices: [{ message: { content: "   " } }] } });
    await expect(getProvider("openai").askQuestion("k", "sys", "q")).rejects.toMatchObject({
      failure: "failed",
    });
  });

  it("keeps provider error bodies off the error message", async () => {
    // The detail is for server logs; the message must stay generic so a
    // caller can't accidentally serialize a provider body to the client.
    stubFetch({ status: 500, text: "SECRET-INTERNAL-TRACE" });
    try {
      await getProvider("openai").askQuestion("k", "sys", "q");
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as ProviderError;
      expect(e.message).not.toContain("SECRET-INTERNAL-TRACE");
      expect(e.detail).toContain("SECRET-INTERNAL-TRACE");
    }
  });
});

describe("provider list integrity", () => {
  it("gives every provider a label and a model", () => {
    // A missing entry here would render "undefined" in the picker or send an
    // undefined model to the API, so the maps must cover the enum exactly.
    for (const name of AI_PROVIDERS) {
      expect(PROVIDER_LABELS[name]).toBeTruthy();
      expect(PROVIDER_MODELS[name]).toBeTruthy();
    }
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual([...AI_PROVIDERS].sort());
    expect(Object.keys(PROVIDER_MODELS).sort()).toEqual([...AI_PROVIDERS].sort());
  });

  it("asks the same model the setup UI advertises", () => {
    // The form names a model before the user commits a key; asking a
    // different one would quietly bill or rate-limit them against something
    // they never agreed to.
    for (const name of AI_PROVIDERS) {
      expect(getProvider(name).model).toBe(PROVIDER_MODELS[name]);
    }
  });

  it("only claims a free tier for providers that have one", () => {
    for (const name of FREE_TIER_PROVIDERS) {
      expect(AI_PROVIDERS).toContain(name);
    }
    // Pay-as-you-go from the first token -- mislabelling these as free would
    // hand someone an unexpected bill.
    expect(FREE_TIER_PROVIDERS.has("openai")).toBe(false);
    expect(FREE_TIER_PROVIDERS.has("anthropic")).toBe(false);
  });

  it("pins OpenRouter to a no-cost model variant", () => {
    // Without the :free suffix the same id bills the user's OpenRouter
    // credit, which defeats the reason they picked it.
    expect(PROVIDER_MODELS.openrouter).toMatch(/:free$/);
  });
});

describe("OpenAI-compatible gateways", () => {
  const gateways = ["openai", "groq", "openrouter", "cerebras"] as const;

  it("handles a 200 response carrying an error body", async () => {
    // OpenRouter and friends return HTTP 200 with an `error` object when an
    // upstream model fails. Reading choices first would show a blank answer.
    for (const name of gateways) {
      stubFetch({ body: { error: { message: "Internal upstream failure" } } });
      await expect(getProvider(name).askQuestion("k", "sys", "q")).rejects.toMatchObject({
        failure: "failed",
      });
    }
  });

  it("treats upstream capacity errors as retryable, not as a bad key", async () => {
    for (const message of [
      "No endpoints found for this model",
      "You are being rate-limited",
      "Provider temporarily unavailable",
    ]) {
      stubFetch({ body: { error: { message } } });
      await expect(getProvider("openrouter").askQuestion("k", "sys", "q")).rejects.toMatchObject({
        failure: "unavailable",
      });
    }
  });

  it("sends the key as a bearer token to the right base URL", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      seen.push({
        url: String(url),
        headers: ((init as RequestInit)?.headers ?? {}) as Record<string, string>,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        text: async () => "",
      };
    }) as unknown as typeof fetch;

    for (const name of gateways) {
      await getProvider(name).askQuestion("secret-key", "sys", "q");
    }

    expect(seen).toHaveLength(gateways.length);
    for (const call of seen) {
      expect(call.url).toMatch(/\/chat\/completions$/);
      expect(call.headers.Authorization).toBe("Bearer secret-key");
    }
    expect(seen[1].url).toContain("api.groq.com");
    expect(seen[2].url).toContain("openrouter.ai");
    expect(seen[3].url).toContain("api.cerebras.ai");
  });
});

describe("stale model ids and reasoning-token exhaustion", () => {
  const gateways = ["openai", "groq", "openrouter", "cerebras"] as const;

  it("classifies a retired model id as model_missing, not a key problem", async () => {
    // This is how this feature is most likely to break over time: providers
    // drop models on their own schedule and nothing fails at build time. The
    // user must not be sent off to regenerate a key that was never at fault.
    for (const name of gateways) {
      stubFetch({
        status: 404,
        text: '{"error":{"message":"The model `x` does not exist or you do not have access to it.","code":"model_not_found"}}',
      });
      await expect(getProvider(name).askQuestion("k", "sys", "q")).rejects.toMatchObject({
        failure: "model_missing",
      });
    }
  });

  it("still reports a genuine 404 that is not about a model as failed", async () => {
    stubFetch({ status: 404, text: '{"error":{"message":"Unknown endpoint"}}' });
    await expect(getProvider("openai").askQuestion("k", "sys", "q")).rejects.toMatchObject({
      failure: "failed",
    });
  });

  it("distinguishes a reasoning model running out of room from a generic failure", async () => {
    // Reasoning models write `reasoning` before `content`. If the ceiling is
    // hit during that phase, the reply is 200 with empty content and
    // finish_reason "length" -- a budget problem with an obvious remedy.
    stubFetch({
      body: {
        choices: [
          { finish_reason: "length", message: { content: "", reasoning: "thinking at length..." } },
        ],
      },
    });
    await expect(getProvider("groq").askQuestion("k", "sys", "q")).rejects.toMatchObject({
      failure: "truncated",
    });
  });

  it("still reports an empty answer with a normal finish_reason as failed", async () => {
    stubFetch({ body: { choices: [{ finish_reason: "stop", message: { content: "" } }] } });
    await expect(getProvider("groq").askQuestion("k", "sys", "q")).rejects.toMatchObject({
      failure: "failed",
    });
  });

  it("returns the answer when a reasoning model completes normally", async () => {
    // `reasoning` alongside `content` must not confuse the extraction.
    stubFetch({
      body: {
        choices: [
          { finish_reason: "stop", message: { reasoning: "worked it out", content: "40%" } },
        ],
      },
    });
    await expect(getProvider("groq").askQuestion("k", "sys", "q")).resolves.toBe("40%");
  });
});
