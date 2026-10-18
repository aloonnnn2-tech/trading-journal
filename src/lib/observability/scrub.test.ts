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
    // Built at runtime (header.payload.signature, base64url) so no JWT-shaped
    // literal sits in source for scanners to flag.
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    const jwt = [b64('{"alg":"HS256","typ":"JWT"}'), b64('{"role":"service_role"}'), b64("not-a-real-signature")].join(".");
    expect(scrubString(`Authorization: Bearer ${jwt}`)).not.toContain(jwt);
  });

  it("redacts Supabase's sb_secret_ keys wherever they sit", () => {
    // Built at runtime so no key-shaped literal sits in source.
    const key = ["sb", "secret", "Zx9" + "q".repeat(30)].join("_");
    const out = scrubString(`createClient failed for ${key} on project x`);
    expect(out).not.toContain(key);
    expect(out).not.toContain("sb_secret_");
  });

  it("redacts unprefixed tokens by where they sit: Bearer, or a credential header", () => {
    // Mistral (32 alphanumerics) and SambaNova (a UUID) issue keys no prefix
    // rule can recognise. Position is the only signal.
    // Assembled at runtime: a 32-character literal here trips GitHub's push
    // protection as a real Mistral key, which is exactly the shape under test.
    const mistral = ["Zz9kQ2mN", "4pR7sT1v", "W3xY5aB8", "cD0eF6gH"].join("");
    const samba = "3f2a9c1e-7b4d-4e8f-9a0b-1c2d3e4f5a6b";
    expect(scrubString(`Authorization: Bearer ${mistral}`)).not.toContain(mistral);
    expect(scrubString(`x-api-key: ${samba}`)).not.toContain(samba);
    expect(scrubString(`{"api_key":"${mistral}"}`)).not.toContain(mistral);
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

describe("formats added 2026-09-30", () => {
  it("catches unprefixed Mistral-style keys and GitHub tokens", () => {
    const mistral = "Zq8mT2vK9pLr4XwB7nYc3HdF6sJe1GaU";
    const out = scrubString(`key was ${mistral} and ghp_${"A1b2".repeat(9)} and github_pat_${"x9Y".repeat(10)}`);
    expect(out).not.toContain(mistral);
    expect(out).not.toContain("ghp_");
    expect(out).not.toContain("github_pat_");
  });

  it("keeps single-case ids and hashes readable", () => {
    const sha = "4143e88b7a0997d619a83f2c1e0f5b6a7c8d9e0f";
    const uuid = "ac7a50d3-5119-469a-8113-f276468b9e52";
    expect(scrubString(`${sha} ${uuid}`)).toBe(`${sha} ${uuid}`);
  });

  it("redacts token/secret/password values and the new field names", () => {
    expect(scrubString('secret="abcdefghijkl"')).not.toContain("abcdefghijkl");
    expect(JSON.stringify(scrubValue({ plaintext: "x", token: "y", password: "z" }))).not.toMatch(/"x"|"y"|"z"/);
  });

  it("recognises the v3 ciphertext envelope", () => {
    expect(scrubString(`v3.${"A".repeat(16)}.${"B".repeat(24)}.${"C".repeat(12)}`)).toBe("[redacted]");
  });
});
