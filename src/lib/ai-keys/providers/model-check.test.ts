import { describe, expect, it } from "vitest";
import { chooseModel, pickerModels } from "./model-check";
import { AI_PROVIDERS, PROVIDER_MODEL_CHOICES, PROVIDER_MODELS } from "../types";

describe("chooseModel", () => {
  it("takes the first choice the provider still offers", () => {
    // Cerebras dropped llama-3.3-70b; a list without the first choice must
    // fall to the second, not fail.
    expect(chooseModel("cerebras", ["qwen-3.8-27b", "zai-glm-4.7"])).toBe("qwen-3.8-27b");
    expect(chooseModel("cerebras", ["gpt-oss-120b", "qwen-3.8-27b"])).toBe("gpt-oss-120b");
  });

  it("keeps the user's own pick while it is still offered, and drops it once it isn't", () => {
    expect(chooseModel("groq", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"], "openai/gpt-oss-20b")).toBe(
      "openai/gpt-oss-20b",
    );
    expect(chooseModel("groq", ["openai/gpt-oss-120b"], "llama-3.3-70b-versatile")).toBe("openai/gpt-oss-120b");
  });

  it("accepts a dated snapshot of an alias, but never a different model sharing a prefix", () => {
    expect(chooseModel("anthropic", ["claude-haiku-4-5-20251001"])).toBe("claude-haiku-4-5-20251001");
    // gemini-3.8-flash-lite is NOT gemini-3.8-flash.
    expect(chooseModel("google", ["gemini-3.8-flash-lite"])).toBeNull();
  });

  it("trusts the stored or first choice when the list couldn't be read", () => {
    expect(chooseModel("google", [])).toBe(PROVIDER_MODELS.google);
    expect(chooseModel("google", [], "gemini-3.8-flash")).toBe("gemini-3.8-flash");
  });

  it("returns null only when a readable list holds none of the choices", () => {
    expect(chooseModel("cerebras", ["llama-3.3-70b"])).toBeNull();
  });
});

describe("pickerModels", () => {
  it("lists chat models only, this app's choices first", () => {
    const list = pickerModels("openai", ["whisper-1", "text-embedding-3-small", "gpt-4o", "gpt-4o-mini", "dall-e-3"]);
    expect(list).toEqual(["gpt-4o-mini", "gpt-4o"]);
  });

  it("offers only :free OpenRouter models, since a paid id bills the user's credit", () => {
    expect(pickerModels("openrouter", ["openai/gpt-5", "qwen/qwen3.8-27b:free"])).toEqual(["qwen/qwen3.8-27b:free"]);
  });
});

describe("PROVIDER_MODEL_CHOICES", () => {
  it("gives every provider at least one choice, and no duplicates", () => {
    for (const p of AI_PROVIDERS) {
      const choices = PROVIDER_MODEL_CHOICES[p];
      expect(choices.length).toBeGreaterThan(0);
      expect(new Set(choices).size).toBe(choices.length);
    }
  });

  it("keeps every OpenRouter choice on the no-cost :free variant", () => {
    for (const id of PROVIDER_MODEL_CHOICES.openrouter) expect(id).toMatch(/:free$/);
  });

  it("no longer asks for the models that were retired", () => {
    expect(PROVIDER_MODEL_CHOICES.cerebras).not.toContain("llama-3.3-70b");
    expect(PROVIDER_MODEL_CHOICES.google).not.toContain("gemini-2.0-flash");
  });
});
