import { describe, expect, it } from "vitest";
import { chatModels, modelHint } from "./model-list";

describe("chatModels", () => {
  it("keeps chat models and drops the ones that can't hold a conversation", () => {
    expect(
      chatModels([
        "gpt-5",
        "gpt-5-mini",
        "text-embedding-3-large",
        "whisper-1",
        "tts-1",
        "dall-e-3",
        "omni-moderation-latest",
        "meta-llama/llama-guard-4-12b",
        "openai/gpt-oss-120b",
        "gpt-5",
      ]),
    ).toEqual(["gpt-5", "gpt-5-mini", "openai/gpt-oss-120b"]);
  });
});

describe("modelHint", () => {
  it("names the small ones", () => {
    for (const m of ["gpt-5-mini", "gemini-3.5-flash-lite", "claude-haiku-5-5", "openai/gpt-oss-20b", "mistral-small-latest"]) {
      expect(modelHint(m), m).toBe("smaller, faster");
    }
  });

  it("names the large ones", () => {
    for (const m of ["claude-opus-5-5", "gemini-3-pro", "mistral-large-latest", "openai/gpt-oss-120b"]) {
      expect(modelHint(m), m).toBe("larger, more capable");
    }
  });

  it("says nothing when the name doesn't say", () => {
    expect(modelHint("gpt-5")).toBeNull();
    expect(modelHint("claude-sonnet-5-5")).toBeNull();
  });
});
