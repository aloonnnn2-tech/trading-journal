import { beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { randomBytes } from "node:crypto";

// Two guarantees behind users' own API keys (security pass, 2026-09-30).

describe("only the vault touches the ciphertext column", () => {
  // Code that names `encrypted_key` in a query or a write. Comments and this
  // test are fine; scrub.ts lists it as a field name to redact.
  const ALLOWED = new Set(["src/lib/ai-keys/vault.ts", "src/lib/observability/scrub.ts"]);

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("has no other file reading or writing encrypted_key", () => {
    const offenders = files("src").filter((file) => {
      const rel = relative(process.cwd(), file).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) return false;
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      return /encrypted_key/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});

describe("v3 ciphertext is bound to its row and provider", () => {
  let encrypt: typeof import("./crypto").encrypt;
  let decrypt: typeof import("./crypto").decryptWithMeta;
  const user = "0f3b1d8e-6f1a-4f7a-9d2e-2a1b3c4d5e6f";
  const binding = { keyId: "11111111-2222-4333-8444-555555555555", provider: "groq" };

  beforeAll(async () => {
    process.env.AI_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("hex");
    process.env.AI_KEY_WRITE_V3 = "true";
    const mod = await import("./crypto");
    mod.resetEncryptionKeyCache();
    encrypt = mod.encrypt;
    decrypt = mod.decryptWithMeta;
  });

  it("round-trips with the same user, row and provider", () => {
    const c = encrypt("gsk_secret", user, binding);
    expect(c.startsWith("v3.")).toBe(true);
    expect(decrypt(c, user, binding)).toEqual({ plaintext: "gsk_secret", stale: false });
  });

  it("refuses the ciphertext moved to another row of the same user", () => {
    const c = encrypt("gsk_secret", user, binding);
    expect(() => decrypt(c, user, { ...binding, keyId: "99999999-2222-4333-8444-555555555555" })).toThrow();
  });

  it("refuses the row's provider being changed", () => {
    const c = encrypt("gsk_secret", user, binding);
    expect(() => decrypt(c, user, { ...binding, provider: "openai" })).toThrow();
  });

  it("refuses a v3 value opened without its binding", () => {
    expect(() => decrypt(encrypt("gsk_secret", user, binding), user)).toThrow();
  });

  it("writes v2 while v3 writing is switched off, so the live site can still read it", () => {
    process.env.AI_KEY_WRITE_V3 = "false";
    try {
      const c = encrypt("gsk_secret", user, binding);
      expect(c.startsWith("v2.")).toBe(true);
      // ...and a v2 value is not flagged for an upgrade it can't have yet.
      expect(decrypt(c, user, binding).stale).toBe(false);
    } finally {
      process.env.AI_KEY_WRITE_V3 = "true";
    }
  });

  it("still opens v2 and marks it for upgrade once the row is known", () => {
    const v2 = encrypt("gsk_secret", user);
    expect(v2.startsWith("v2.")).toBe(true);
    expect(decrypt(v2, user, binding)).toEqual({ plaintext: "gsk_secret", stale: true });
    expect(decrypt(v2, user)).toEqual({ plaintext: "gsk_secret", stale: false });
  });
});
