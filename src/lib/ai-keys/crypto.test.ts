import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  decrypt,
  decryptWithMeta,
  encrypt,
  lastFour,
  resetEncryptionKeyCache,
} from "./crypto";

// A throwaway key per run -- never a hardcoded one, so a copy/paste of this
// file can't become a real deployment's secret.
const TEST_SECRET = randomBytes(32).toString("base64");

// Every ciphertext is bound to its owner's user id, so the tests need one.
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";

function setPreviousSecrets(value: string | undefined) {
  if (value === undefined) delete process.env.AI_KEY_ENCRYPTION_SECRET_PREVIOUS;
  else process.env.AI_KEY_ENCRYPTION_SECRET_PREVIOUS = value;
  resetEncryptionKeyCache();
}

function setSecret(value: string | undefined) {
  if (value === undefined) delete process.env.AI_KEY_ENCRYPTION_SECRET;
  else process.env.AI_KEY_ENCRYPTION_SECRET = value;
  // The module caches the decoded key after first use, so every change has to
  // invalidate it or later tests would silently keep using the first secret.
  resetEncryptionKeyCache();
}

beforeEach(() => setSecret(TEST_SECRET));
afterEach(() => {
  setSecret(undefined);
  setPreviousSecrets(undefined);
});

describe("encrypt/decrypt", () => {
  it("round-trips a value unchanged", () => {
    const plaintext = "sk-proj-abc123DEF456ghi789";
    expect(decrypt(encrypt(plaintext, OWNER), OWNER)).toBe(plaintext);
  });

  it("round-trips values that stress the encoding", () => {
    const cases = [
      "a".repeat(500), // long
      "sk-ant-api03-_-aBc123", // punctuation providers actually use
      "ключ-日本語-🔑", // multi-byte utf8, in case a label-ish value passes through
      "x", // minimum conceivable
    ];
    for (const plaintext of cases) {
      expect(decrypt(encrypt(plaintext, OWNER), OWNER)).toBe(plaintext);
    }
  });

  it("produces different ciphertext each time for the same input", () => {
    // A fresh IV per call is what makes this true. If this ever fails, IV
    // reuse has been introduced -- which breaks AES-GCM catastrophically
    // (keystream recovery and forgery), not just cosmetically.
    const plaintext = "sk-proj-abc123DEF456ghi789";
    const a = encrypt(plaintext, OWNER);
    const b = encrypt(plaintext, OWNER);
    expect(a).not.toBe(b);
    expect(decrypt(a, OWNER)).toBe(decrypt(b, OWNER));
  });

  it("never leaves the plaintext visible in the ciphertext", () => {
    const plaintext = "sk-proj-SUPERSECRETVALUE123";
    const encrypted = encrypt(plaintext, OWNER);
    expect(encrypted).not.toContain(plaintext);
    expect(encrypted).not.toContain("SUPERSECRET");
  });

  it("emits the versioned four-part envelope", () => {
    const parts = encrypt("sk-proj-abc123DEF456ghi789", OWNER).split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v2");
    // 12-byte IV and 16-byte tag, base64-encoded.
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[2], "base64")).toHaveLength(16);
  });
});

describe("decrypt rejects anything it shouldn't accept", () => {
  const plaintext = "sk-proj-abc123DEF456ghi789";

  it("rejects a tampered ciphertext body", () => {
    const parts = encrypt(plaintext, OWNER).split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff; // flip a bit
    parts[3] = data.toString("base64");
    // This is the GCM auth tag doing its job: without it, a database with
    // write access could swap a user's key for an attacker's undetected.
    expect(() => decrypt(parts.join("."), OWNER)).toThrow("Could not decrypt stored API key.");
  });

  it("rejects a tampered auth tag", () => {
    const parts = encrypt(plaintext, OWNER).split(".");
    const tag = Buffer.from(parts[2], "base64");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64");
    expect(() => decrypt(parts.join("."), OWNER)).toThrow("Could not decrypt stored API key.");
  });

  it("rejects ciphertext encrypted under a different key", () => {
    const encrypted = encrypt(plaintext, OWNER);
    setSecret(randomBytes(32).toString("base64"));
    expect(() => decrypt(encrypted, OWNER)).toThrow("Could not decrypt stored API key.");
  });

  it("rejects malformed and unknown-version envelopes", () => {
    const malformed = [
      "",
      "not-encrypted-at-all",
      "v1.only.three",
      "v2.aaaa.bbbb.cccc",
      encrypt(plaintext, OWNER).replace("v2.", "v9."),
    ];
    for (const value of malformed) {
      expect(() => decrypt(value, OWNER)).toThrow("Could not decrypt stored API key.");
    }
  });

  it("gives the same message for every failure, revealing nothing", () => {
    // Distinguishing "wrong key" from "corrupt data" is exactly the oracle
    // that makes decryption endpoints attackable, so the messages must match.
    const wrongVersion = (() => {
      try {
        decrypt("v9.aaaa.bbbb.cccc", OWNER);
      } catch (e) {
        return (e as Error).message;
      }
    })();
    const tampered = (() => {
      const parts = encrypt(plaintext, OWNER).split(".");
      parts[3] = Buffer.from("garbage").toString("base64");
      try {
        decrypt(parts.join("."), OWNER);
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
    expect(decrypt(encrypt("sk-proj-abc123DEF456ghi789", OWNER), OWNER)).toBe(
      "sk-proj-abc123DEF456ghi789",
    );
  });

  it("refuses to run with no secret configured", () => {
    setSecret(undefined);
    expect(() => encrypt("anything", OWNER)).toThrow(/AI_KEY_ENCRYPTION_SECRET is not set/);
  });

  it("refuses a secret that decodes to the wrong length", () => {
    // Silently accepting a short secret would weaken every key in the
    // database with nothing to show for it, so this must be loud.
    setSecret(randomBytes(16).toString("base64"));
    expect(() => encrypt("anything", OWNER)).toThrow(/must decode to 32 bytes/);
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

// The flaw this binding closes: before it, ciphertext carried no record of who
// it belonged to, so write access to the database was enough to lift a row's
// encrypted_key into another account and *use* that key -- no encryption
// secret required.
describe("owner binding", () => {
  const plaintext = "sk-proj-owner-bound-key-value";

  it("refuses to decrypt under a different owner", () => {
    const encrypted = encrypt(plaintext, OWNER);
    expect(() => decrypt(encrypted, OTHER_OWNER)).toThrow("Could not decrypt stored API key.");
  });

  it("still decrypts under the right owner", () => {
    expect(decrypt(encrypt(plaintext, OWNER), OWNER)).toBe(plaintext);
  });

  it("gives a transplant the same generic error as corruption", () => {
    // Otherwise the error itself tells an attacker that the ciphertext was
    // valid and only the owner was wrong.
    const transplanted = (() => {
      try {
        decrypt(encrypt(plaintext, OWNER), OTHER_OWNER);
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(transplanted).toBe("Could not decrypt stored API key.");
  });
});

describe("secret rotation", () => {
  const plaintext = "sk-proj-rotate-me-please-1234";

  it("decrypts values written under a retired secret", () => {
    const oldSecret = TEST_SECRET;
    const encrypted = encrypt(plaintext, OWNER);

    // Rotate: a brand-new current secret, the old one kept for reading.
    setSecret(randomBytes(32).toString("base64"));
    setPreviousSecrets(oldSecret);

    expect(decrypt(encrypted, OWNER)).toBe(plaintext);
  });

  it("flags a value read under a retired secret as needing rewriting", () => {
    const oldSecret = TEST_SECRET;
    const encrypted = encrypt(plaintext, OWNER);

    setSecret(randomBytes(32).toString("base64"));
    setPreviousSecrets(oldSecret);

    const result = decryptWithMeta(encrypted, OWNER);
    expect(result.plaintext).toBe(plaintext);
    // This is what drives the opportunistic re-encryption in queries.ts, and
    // therefore what lets a leaked secret actually be retired rather than
    // merely supplemented.
    expect(result.stale).toBe(true);
  });

  it("does not flag a value already written under the current secret", () => {
    expect(decryptWithMeta(encrypt(plaintext, OWNER), OWNER).stale).toBe(false);
  });

  it("supports retiring several generations at once", () => {
    const first = TEST_SECRET;
    const encryptedUnderFirst = encrypt(plaintext, OWNER);

    const second = randomBytes(32).toString("base64");
    setSecret(second);
    const encryptedUnderSecond = encrypt(plaintext, OWNER);

    setSecret(randomBytes(32).toString("base64"));
    setPreviousSecrets(`${second}, ${first}`);

    expect(decrypt(encryptedUnderFirst, OWNER)).toBe(plaintext);
    expect(decrypt(encryptedUnderSecond, OWNER)).toBe(plaintext);
  });

  it("still fails when no configured secret matches", () => {
    const encrypted = encrypt(plaintext, OWNER);
    setSecret(randomBytes(32).toString("base64"));
    setPreviousSecrets(randomBytes(32).toString("base64"));
    expect(() => decrypt(encrypted, OWNER)).toThrow("Could not decrypt stored API key.");
  });

  it("rejects a malformed retired secret rather than ignoring it", () => {
    // Silently skipping an unreadable previous secret would make a botched
    // rotation look like it worked, right up until real keys stopped
    // decrypting in production.
    setPreviousSecrets("not-a-valid-secret");
    expect(() => encrypt(plaintext, OWNER)).toThrow(/must decode to 32 bytes/);
  });
});

describe("legacy v1 ciphertext", () => {
  // Real keys are stored in v1 in production. They must keep working, and
  // must be reported as needing migration to v2.
  const plaintext = "sk-proj-legacy-stored-value-1";

  function makeV1(value: string, secretB64: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(secretB64, "base64"), iv);
    const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [
      "v1",
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ct.toString("base64"),
    ].join(".");
  }

  it("decrypts v1 ciphertext, which has no owner bound into it", () => {
    const legacy = makeV1(plaintext, TEST_SECRET);
    expect(decrypt(legacy, OWNER)).toBe(plaintext);
    // Any owner works, because v1 authenticated none -- which is precisely
    // the weakness v2 exists to close.
    expect(decrypt(legacy, OTHER_OWNER)).toBe(plaintext);
  });

  it("marks v1 ciphertext stale so it gets rewritten as v2", () => {
    expect(decryptWithMeta(makeV1(plaintext, TEST_SECRET), OWNER).stale).toBe(true);
  });
});
