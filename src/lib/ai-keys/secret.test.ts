import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { SecretKey, redactKey, reveal } from "./secret";
import { errorDetail, ProviderError } from "./providers/types";

const KEY = "Zq8mT2vK9pLr4XwB7nYc3HdF6sJe1GaU"; // Mistral-shaped: no prefix at all

describe("SecretKey never prints its value", () => {
  const k = new SecretKey(KEY);

  it("hides it from string conversion, JSON and Node's inspector", () => {
    expect(String(k)).toBe("[redacted]");
    expect(`${k}`).toBe("[redacted]");
    expect(JSON.stringify({ k })).toBe('{"k":"[redacted]"}');
    expect(inspect(k)).not.toContain(KEY);
    expect(inspect({ nested: { k } }, { depth: 5 })).not.toContain(KEY);
  });

  it("keeps nothing on the object itself, so spreads and clones are empty", () => {
    expect(Object.keys(k)).toEqual([]);
    expect(JSON.stringify({ ...k })).toBe("{}");
    expect(Object.getOwnPropertyNames(k)).toEqual([]);
  });

  it("gives the value only through reveal()", () => {
    expect(k.reveal()).toBe(KEY);
    expect(reveal(k)).toBe(KEY);
    expect(reveal("typed-in")).toBe("typed-in");
  });

  it("can't be changed after it is made", () => {
    expect(Object.isFrozen(k)).toBe(true);
  });
});

describe("redactKey", () => {
  it("removes the whole key and long fragments of it from provider text", () => {
    const body = `{"error":"Invalid key ${KEY}","hint":"...${KEY.slice(4, 28)}..."}`;
    const out = redactKey(body, new SecretKey(KEY));
    expect(out).not.toContain(KEY);
    expect(out).not.toContain(KEY.slice(4, 28));
  });

  it("leaves text alone when no key is given", () => {
    expect(redactKey("plain", undefined)).toBe("plain");
  });
});

describe("provider errors can't carry a key", () => {
  it("errorDetail strips the key a provider echoed back", async () => {
    const res = new Response(`Incorrect API key provided: ${KEY}`, { status: 401 });
    const detail = await errorDetail(res, new SecretKey(KEY));
    expect(detail).not.toContain(KEY);
    expect(detail).toContain("HTTP 401");
  });

  it("ProviderError scrubs its detail even when built from raw text", () => {
    const err = new ProviderError("failed", `upstream said sk-proj-${"a".repeat(30)} and ${KEY}`);
    expect(err.detail).not.toContain("sk-proj-");
    expect(err.detail).not.toContain(KEY);
  });
});
