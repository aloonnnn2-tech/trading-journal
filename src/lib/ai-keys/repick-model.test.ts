import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const rateLimit = vi.fn();
const setApiKeyModel = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock("@/lib/ai-keys/queries", () => ({ setApiKeyModel: (...a: unknown[]) => setApiKeyModel(...a) }));

const { withRetiredModelRetry } = await import("./repick-model");
const { ProviderError } = await import("./providers/types");
const { SecretKey } = await import("./secret");

function options(models: string[], deadlineIn = 20_000) {
  return {
    supabase: {} as SupabaseClient,
    userId: "user-1",
    keyId: "key-1",
    providerName: "groq" as const,
    provider: { validateKey: vi.fn(async () => ({ valid: true, models })) } as never,
    key: new SecretKey("gsk_test"),
    model: "old-model",
    logPrefix: "test",
    deadlineAt: Date.now() + deadlineIn,
  };
}

beforeEach(() => {
  rateLimit.mockReset().mockResolvedValue({ ok: true });
  setApiKeyModel.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("withRetiredModelRetry", () => {
  it("re-picks a retired model, saves the pick and runs once more with it", async () => {
    const opts = options(["old-model", "openai/gpt-oss-20b"]);
    const run = vi.fn(async (model: string) => {
      if (model === "old-model") throw new ProviderError("model_missing", "gone");
      return model;
    });
    await expect(withRetiredModelRetry(run, opts)).resolves.toBe("openai/gpt-oss-20b");
    expect(run).toHaveBeenCalledTimes(2);
    expect(setApiKeyModel).toHaveBeenCalledWith(opts.supabase, "key-1", "openai/gpt-oss-20b", { userId: "user-1" });
  });

  it("rethrows any other failure without checking the key", async () => {
    const opts = options(["x"]);
    const err = new ProviderError("unavailable", "slow down");
    await expect(withRetiredModelRetry(async () => Promise.reject(err), opts)).rejects.toBe(err);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("gives up when the daily key-check budget is spent", async () => {
    rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
    const err = new ProviderError("model_missing", "gone");
    const run = vi.fn(async () => Promise.reject(err));
    await expect(withRetiredModelRetry(run, options(["new"]))).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("doesn't start a second attempt it has no time left for", async () => {
    const err = new ProviderError("model_missing", "gone");
    const run = vi.fn(async () => Promise.reject(err));
    await expect(withRetiredModelRetry(run, options(["new"], 3_000))).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
    expect(rateLimit).not.toHaveBeenCalled();
  });
});
