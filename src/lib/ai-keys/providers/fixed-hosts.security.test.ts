import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { apiKeyCreateSchema } from "../schema";

// Security gaps pass, 7.1 (SSRF): the app calls AI providers with the user's
// key from OUR server, so a user-chosen endpoint would let anyone make this
// server fetch any URL (cloud metadata, internal hosts) -- open question 2,
// answered "fixed hosts only" by the code. These pin it: every provider URL
// is a literal on this list, and a key can't carry an endpoint in.

const ALLOWED_HOSTS = new Set([
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.openai.com",
  "api.groq.com",
  "openrouter.ai",
  "api.cerebras.ai",
  "api.mistral.ai",
  "api.sambanova.ai",
  "models.github.ai",
]);

const dir = __dirname;
const sources = readdirSync(dir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => ({ file: f, text: readFileSync(path.join(dir, f), "utf8") }));

describe("AI provider endpoints are fixed", () => {
  it("every https URL in the provider code is on the allowlist", () => {
    const hosts = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/["'`](https:\/\/[^"'`\s/$]+)/g)].map((m) => ({ file, host: new URL(m[1]).host })),
    );
    // Only real endpoints, not the OpenRouter attribution referer.
    const endpoints = hosts.filter((h) => h.host !== "github.com");
    expect(endpoints.length).toBeGreaterThanOrEqual(ALLOWED_HOSTS.size);
    expect(endpoints.filter((h) => !ALLOWED_HOSTS.has(h.host))).toEqual([]);
  });

  it("every baseUrl / BASE / modelsUrl is a string literal, never built from input", () => {
    const assignments = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/\b(baseUrl|modelsUrl)\s*:\s*([^,\n]+)|\bconst BASE\s*=\s*([^;\n]+)/g)]
        .map((m) => ({ file, value: (m[2] ?? m[3]).trim() }))
        // Type declarations in openai-compatible.ts (`baseUrl: string;`).
        .filter((a) => !/^string;?$/.test(a.value)),
    );
    expect(assignments.length).toBeGreaterThan(5);
    expect(assignments.filter((a) => !/^"https:\/\/[^"]+"$/.test(a.value))).toEqual([]);
  });

  it("drops any endpoint a client tries to send with a key", () => {
    const parsed = apiKeyCreateSchema.parse({
      provider: "openai",
      key: "sk-test-not-a-real-key-000000",
      baseUrl: "http://169.254.169.254/latest/meta-data",
      endpoint: "http://localhost:5432",
    });
    expect(Object.keys(parsed).sort()).toEqual(["key", "label", "provider"]);
  });

  it("follows no redirects off those hosts: every fetch sets redirect: \"error\"", () => {
    const calls = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/await fetch\(/g)].map((m) => ({ file, window: text.slice(m.index, m.index + 600) })),
    );
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls.filter((c) => !/redirect:\s*"error"/.test(c.window)).map((c) => c.file)).toEqual([]);
  });
});
