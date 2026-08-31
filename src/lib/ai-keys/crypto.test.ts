import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, lastFour, resetEncryptionKeyCache } from "./crypto";

// A throwaway key per run -- never a hardcoded one, so a copy/paste of this
// file can't become a real deployment's secret.
const TEST_SECRET = randomBytes(32).toString("base64");

function setSecret(value: string | undefined) {
  if (value === undefined) delete process.env.AI_KEY_ENCRYPTION_SECRET;
  else process.env.AI_KEY_ENCRYPTION_SECRET = value;
  // The module caches the decoded key after first use, so every change has to
  // invalidate it or later tests would silently keep using the first secret.
  resetEncryptionKeyCache();
}

beforeEach(() => setSecret(TEST_SECRET));
afterEach(() => setSecret(undefined));

describe("encrypt/decrypt", () => {
  it("round-trips a value unchanged", () => {
    const plaintext = "sk-proj-abc123DEF456ghi789";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("round-trips values that stress the encoding", () => {
    const cases = [
      "a".repeat(500), // long
      "sk-ant-api03-_-aBc123", // punctuation providers actually use
      "ключ-日本語-🔑", // multi-byte utf8, in case a label-ish value passes through
      "x", // minimum conceivable
    ];
    for (const plaintext of cases) {
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    }
  });

  it("produces different ciphertext each time for the same input", () => {
    // A fresh IV per call is what makes this true. If this ever fails, IV
    // reuse has been introduced -- which breaks AES-GCM catastrophically
    // (keystream recovery and forgery), not just cosmetically.
    const plaintext = "sk-proj-abc123DEF456ghi789";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it("never leaves the plaintext visible in the ciphertext", () => {
    const plaintext = "sk-proj-SUPERSECRETVALUE123";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(encrypted).not.toContain("SUPERSECRET");
  });

  it("emits the versioned four-part envelope", () => {
    const parts = encrypt("sk-proj-abc123DEF456ghi789").split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    // 12-byte IV and 16-byte tag, base64-encoded.
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[2], "base64")).toHaveLength(16);
  });
});

describe("decrypt rejects anything it shouldn't accept", () => {
  const plaintext = "sk-proj-abc123DEF456ghi789";

  it("rejects a tampered ciphertext body", () => {
    const parts = encrypt(plaintext).split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff; // flip a bit
    parts[3] = data.toString("base64");
    // This is the GCM auth tag doing its job: without it, a database with
    // write access could swap a user's key for an attacker's undetected.
    expect(() => decrypt(parts.join("."))).toThrow("Could not decrypt stored API key.");
  });

  it("rejects a tampered auth tag", () => {
    const parts = encrypt(plaintext).split(".");
    const tag = Buffer.from(parts[2], "base64");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow("Could not decrypt stored API key.");
  });

  it("rejects ciphertext encrypted under a different key", () => {
    const encrypted = encrypt(plaintext);
    setSecret(randomBytes(32).toString("base64"));
    expect(() => decrypt(encrypted)).toThrow("Could not decrypt stored API key.");
  });

  it("rejects malformed and unknown-version envelopes", () => {
    const malformed = [
      "",
      "not-encrypted-at-all",
      "v1.only.three",
      "v2.aaaa.bbbb.cccc",
      encrypt(plaintext).replace("v1.", "v9."),
    ];
    for (const value of malformed) {
      expect(() => decrypt(value)).toThrow("Could not decrypt stored API key.");
    }
  });

  it("gives the same message for every failure, revealing nothing", () => {
    // Distinguishing "wrong key" from "corrupt data" is exactly the oracle
    // that makes decryption endpoints attackable, so the messages must match.
    const wrongVersion = (() => {
      try {
        decrypt("v9.aaaa.bbbb.cccc");
      } catch (e) {
        return (e as Error).message;
      }
    })();
    const tampered = (() => {
      const parts = encrypt(plaintext).split(".");
      parts[3] = Buffer.from("garbage").toString("base64");
      try {
        decrypt(parts.join("."));
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(wrongVersion).toBe(tampered);
  });
});

describe("encryption key validation", () => {
  it("accepts a 64-character hex secret", () => {
    setSecret(randomBytes(32).toString("hex"));
    expect(decrypt(encrypt("sk-proj-abc123DEF456ghi789"))).toBe("sk-proj-abc123DEF456ghi789");
  });

  it("refuses to run with no secret configured", () => {
    setSecret(undefined);
    expect(() => encrypt("anything")).toThrow(/AI_KEY_ENCRYPTION_SECRET is not set/);
  });

  it("refuses a secret that decodes to the wrong length", () => {
    // Silently accepting a short secret would weaken every key in the
    // database with nothing to show for it, so this must be loud.
    setSecret(randomBytes(16).toString("base64"));
    expect(() => encrypt("anything")).toThrow(/must decode to 32 bytes/);
  });
});

describe("lastFour", () => {
  it("returns the trailing four characters for a realistic key", () => {
    expect(lastFour("sk-proj-abc123DEF456gh4a2f")).toBe("4a2f");
  });

  it("ignores surrounding whitespace from a sloppy paste", () => {
    expect(lastFour("  sk-proj-abcd1234\n")).toBe("1234");
  });

  it("never returns more than the whole short string", () => {
    // Bounded so a short value can't produce a "mask" that is the entire
    // secret plus padding. The schema rejects these before storage anyway.
    expect(lastFour("ab")).toBe("ab");
    expect(lastFour("")).toBe("");
  });
});
