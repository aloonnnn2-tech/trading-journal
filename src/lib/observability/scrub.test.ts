import { describe, expect, it } from "vitest";
import { scrubEvent, scrubString, scrubValue } from "./scrub";

// Realistic shapes, wrong values. Nothing here is a real credential -- the
// point is that each matches the pattern a real one would.
const KEYS = {
  openai: "sk-proj-AbCdEf0123456789GhIjKlMnOpQrStUvWxYz",
  anthropic: "sk-ant-api03-AbCdEf0123456789GhIjKlMnOpQr",
  openrouter: "sk-or-v1-AbCdEf0123456789GhIjKlMnOpQrStUv",
  google: "AIzaSyA0123456789abcdefghijklmnopqrstu",
  groq: "gsk_AbCdEf0123456789GhIjKlMnOpQrStUvWx",
  cerebras: "csk-AbCdEf0123456789GhIjKlMnOpQrStUvWx",
};

describe("scrubString", () => {
  it.each(Object.entries(KEYS))("redacts a %s-shaped key", (_provider, key) => {
    const scrubbed = scrubString(`provider rejected key ${key} with 401`);
    expect(scrubbed).not.toContain(key);
    expect(scrubbed).toContain("[redacted]");
  });

  // The overlapping-prefix case: `sk-or-` and `sk-ant-` both start with `sk-`,
  // so a careless pattern order leaves the distinctive part behind and calls
  // it redacted.
  it("redacts overlapping prefixes completely, leaving no tail behind", () => {
    for (const key of [KEYS.openrouter, KEYS.anthropic]) {
      const scrubbed = scrubString(key);
      expect(scrubbed).not.toContain(key);
      // No fragment of the secret material should survive.
      expect(scrubbed).not.toMatch(/[A-Za-z0-9_-]{16,}/);
    }
  });

  it("redacts our own stored-key envelope", () => {
    const envelope =
      "v2.YWJjZGVmZ2hpamts.MTIzNDU2Nzg5MDEyMzQ1Ng==.c29tZSBjaXBoZXJ0ZXh0IGhlcmU=";
    expect(scrubString(`decrypt failed for ${envelope}`)).not.toContain(envelope);
    // v1 is still in production and must be caught too.
    expect(scrubString(envelope.replace("v2.", "v1."))).toContain("[redacted]");
  });

  it("redacts JWT-shaped tokens, which includes the service-role key", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.AbCdEf0123456789xyz";
    expect(scrubString(`Authorization: Bearer ${jwt}`)).not.toContain(jwt);
  });

  it("leaves ordinary text alone", () => {
    const message = "Could not decrypt stored API key.";
    expect(scrubString(message)).toBe(message);
    expect(scrubString("trade AAPL closed at 214.50")).toBe("trade AAPL closed at 214.50");
  });
});

describe("scrubValue", () => {
  it("redacts secrets nested deep inside an event", () => {
    const event = {
      exception: {
        values: [{ value: `request failed with ${KEYS.openai}`, type: "Error" }],
      },
      breadcrumbs: [{ message: `using ${KEYS.groq}` }],
    };
    const scrubbed = scrubValue(event);
    expect(JSON.stringify(scrubbed)).not.toContain(KEYS.openai);
    expect(JSON.stringify(scrubbed)).not.toContain(KEYS.groq);
  });

  // A value that doesn't match any pattern is still a secret if it sits under
  // a name that says so -- a short or future-format key, say.
  it("redacts by field name regardless of the value's shape", () => {
    const scrubbed = scrubValue({
      request: { headers: { authorization: "Bearer whatever", "x-goog-api-key": "short" } },
      extra: { encrypted_key: "not-envelope-shaped", api_key: "abc" },
    }) as unknown as {
      request: { headers: Record<string, string> };
      extra: Record<string, string>;
    };

    expect(scrubbed.request.headers.authorization).toBe("[redacted]");
    expect(scrubbed.request.headers["x-goog-api-key"]).toBe("[redacted]");
    expect(scrubbed.extra.encrypted_key).toBe("[redacted]");
    expect(scrubbed.extra.api_key).toBe("[redacted]");
  });

  it("matches field names case-insensitively", () => {
    const scrubbed = scrubValue({ Authorization: "Bearer x", API_KEY: "y" }) as Record<
      string,
      string
    >;
    expect(scrubbed.Authorization).toBe("[redacted]");
    expect(scrubbed.API_KEY).toBe("[redacted]");
  });

  it("does not mutate the input", () => {
    const original = { message: `key ${KEYS.openai}` };
    scrubValue(original);
    expect(original.message).toContain(KEYS.openai);
  });

  it("preserves the parts of an event that make it useful", () => {
    const scrubbed = scrubValue({
      level: "error",
      message: "Provider request failed: invalid_key",
      tags: { route: "/api/ask-ai" },
    }) as Record<string, unknown>;

    expect(scrubbed.level).toBe("error");
    expect(scrubbed.message).toBe("Provider request failed: invalid_key");
    expect(scrubbed.tags).toEqual({ route: "/api/ask-ai" });
  });

  it("survives a cyclic structure rather than hanging inside the error handler", () => {
    const cyclic: Record<string, unknown> = { message: `key ${KEYS.openai}` };
    cyclic.self = cyclic;
    expect(() => scrubValue(cyclic)).not.toThrow();
  });

  it("leaves non-plain objects untouched", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    expect(scrubValue({ when: date }).when).toBe(date);
  });
});

describe("scrubEvent", () => {
  it("returns the scrubbed event", () => {
    const scrubbed = scrubEvent({ message: `boom ${KEYS.anthropic}` });
    expect(JSON.stringify(scrubbed)).not.toContain(KEYS.anthropic);
  });

  // Dropping beats sending: an event we couldn't scrub is precisely the one
  // that must not reach a third party.
  it("drops the event rather than sending something it could not scrub", () => {
    const hostile = {
      get message(): string {
        throw new Error("nope");
      },
    };
    expect(scrubEvent(hostile)).toBeNull();
  });
});
