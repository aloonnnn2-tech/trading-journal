// Enforces the SERVER ONLY warning below at build time: if this module ever
// reaches a client bundle the build fails, instead of shipping
// AI_KEY_ENCRYPTION_SECRET -- the key that decrypts every stored provider
// API key -- to every visitor.
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Symmetric encryption for user-supplied AI provider API keys.
//
// **SERVER ONLY.** Never import this from a client component or anything that
// ends up in the browser bundle: it reads a secret from the environment, and
// bundling it would ship that secret to every visitor. It has no "use client"
// sibling and nothing in src/components should ever reach for it.
//
// Threat model, stated plainly so the limits are obvious: this protects keys
// **at rest**. Someone who obtains a database dump (a leaked backup, a stolen
// read replica, a misconfigured RLS policy) gets ciphertext and cannot use it,
// because the key lives in the environment rather than the database. It does
// NOT protect against an attacker who already has code execution on the
// server -- they can read the env var and decrypt at will. That is the normal
// and accepted boundary for this kind of storage; the alternative (never
// storing keys at all) would mean re-pasting a key for every question.

const ALGORITHM = "aes-256-gcm";
// 96-bit IV is the size AES-GCM is specified for and the size Node's GCM
// implementation is fastest and safest with. A fresh one per encrypt() is
// mandatory: reusing an IV under the same key breaks GCM catastrophically,
// leaking the keystream and allowing forgery -- not merely weakening it.
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256

// Versioned so a future key rotation or algorithm change can recognize and
// migrate old ciphertext instead of failing to decrypt it with no way to tell
// "wrong key" from "different format".
const FORMAT_VERSION = "v1";

let cachedKey: Buffer | null = null;

/**
 * Reads and validates the encryption key.
 *
 * Read lazily rather than at module load so that importing this module (which
 * Next.js does while building routes, and vitest does while collecting tests)
 * doesn't hard-fail an environment that simply hasn't configured the feature.
 * The failure surfaces when someone actually tries to store a key, where the
 * route can turn it into a clear 501 instead of a build error.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!raw) {
    throw new Error(
      "AI_KEY_ENCRYPTION_SECRET is not set -- required to store AI provider API keys.",
    );
  }

  // Accept hex or base64 so whichever generator the operator reaches for
  // works. Both are checked for the decoded length rather than the string
  // length, because a too-short secret silently weakens every key in the
  // database and must not be tolerated quietly.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `AI_KEY_ENCRYPTION_SECRET must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }

  cachedKey = key;
  return key;
}

/**
 * Whether encryption is usable, without throwing.
 *
 * Routes call this before touching encrypt()/decrypt() so a missing or
 * malformed secret becomes a clear "not configured on this server" message
 * instead of an unhandled exception surfacing as a bare 500 -- which is
 * exactly what a fresh deployment that forgot the env var would produce.
 */
export function isEncryptionConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forces the next call to re-read the environment. */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}

/**
 * Encrypts a plaintext secret. Output is safe to store in a text column.
 *
 * Format: `v1.<iv>.<authTag>.<ciphertext>`, each part base64. The auth tag is
 * what makes this AEAD rather than plain encryption -- decrypt() will refuse
 * ciphertext that has been altered, so a database with write access can't be
 * used to swap a user's key for an attacker-controlled one undetected.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Decrypts what encrypt() produced. Throws on tampering, a wrong key, or a
 * malformed payload.
 *
 * Every failure path throws the same generic message. The caller cannot
 * distinguish "wrong key" from "corrupted ciphertext" from "bad auth tag" --
 * deliberately, since distinguishing them is exactly the oracle that turns a
 * decryption endpoint into a padding-oracle-style attack surface. The specific
 * cause is a server-side debugging concern, not something to hand back.
 */
export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Could not decrypt stored API key.");
  }

  const [, ivB64, authTagB64, dataB64] = parts;

  try {
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const data = Buffer.from(dataB64, "base64");

    // Node throws a confusing error for a wrong-length tag; checking up front
    // keeps the single generic failure mode above.
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new Error("bad envelope");
    }

    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt stored API key.");
  }
}

/**
 * The masked suffix shown in the UI, e.g. "4a2f" for "•••• 4a2f".
 *
 * Four characters of a 40+ character secret doesn't meaningfully narrow a
 * brute force, and it's the only way a user can tell two keys from the same
 * provider apart once both are masked. Keys shorter than this are rejected by
 * the schema before they reach storage, but the slice is bounded anyway so a
 * short string can never produce a "mask" that is the entire secret.
 */
export function lastFour(plaintext: string): string {
  const trimmed = plaintext.trim();
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
}
