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
// Threat model, stated plainly so the limits are obvious.
//
// PROTECTED — a database breach. Someone who obtains a database dump (a leaked
// backup, a stolen read replica, a misconfigured RLS policy, SQL injection)
// gets AES-256-GCM ciphertext and nothing else. The key that decrypts it lives
// in the process environment, never in the database, so the dump alone is
// useless. This is the case this module exists for.
//
// PROTECTED — moving ciphertext between accounts. Every value is bound to its
// owner's user id as GCM additional authenticated data, so a ciphertext lifted
// from one row and pasted into another fails authentication instead of
// decrypting. Without this, write access to the database was enough to *use*
// another user's key (not read it, but spend it) with no need for the
// encryption secret at all. See encrypt().
//
// PROTECTED — a leaked encryption secret, provided it is noticed. Rotation is
// supported: set the new secret as AI_KEY_ENCRYPTION_SECRET and keep the old
// one in AI_KEY_ENCRYPTION_SECRET_PREVIOUS, and stored keys are transparently
// re-encrypted under the new secret as they are used. Without that, a leaked
// secret meant every stored key was compromised permanently, because there
// was no way to change it short of making every user re-paste their key.
//
// NOT PROTECTED — an attacker with code execution on the server. They can read
// the environment and decrypt at will. This is unavoidable for any design where
// the server calls the provider on the user's behalf: something has to hold a
// usable key at the moment of the call. The only way to close it is to never
// give the server a usable key at all -- encrypt client-side under a passphrase
// only the user knows -- which costs the user a passphrase entry every session
// and breaks any future scheduled/background AI work. That trade has not been
// made here; see SECURITY.md.

const ALGORITHM = "aes-256-gcm";
// 96-bit IV is the size AES-GCM is specified for and the size Node's GCM
// implementation is fastest and safest with. A fresh one per encrypt() is
// mandatory: reusing an IV under the same key breaks GCM catastrophically,
// leaking the keystream and allowing forgery -- not merely weakening it.
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256

// Versioned so a rotation or algorithm change can recognize and migrate old
// ciphertext instead of failing to decrypt it with no way to tell "wrong key"
// from "different format".
//
//   v1 -- no additional authenticated data. Ciphertext was not bound to any
//         account, so it could be transplanted between rows. Still decrypted,
//         because real keys are stored in this format in production; every one
//         read is re-encrypted to v2 in passing (see queries.ts).
//   v2 -- AAD is the owning user's id.
const FORMAT_V1 = "v1";
const FORMAT_V2 = "v2";
const CURRENT_FORMAT = FORMAT_V2;

let cachedKeys: Buffer[] | null = null;

/** Decodes one secret from hex or base64, or throws explaining what's wrong. */
function decodeSecret(raw: string, varName: string): Buffer {
  // Accept hex or base64 so whichever generator the operator reaches for
  // works. Both are checked for the decoded length rather than the string
  // length, because a too-short secret silently weakens every key in the
  // database and must not be tolerated quietly.
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${varName} must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

/**
 * Every secret this process can decrypt with, current first.
 *
 * Index 0 is AI_KEY_ENCRYPTION_SECRET and is the only one anything is ever
 * encrypted *under*. The rest come from AI_KEY_ENCRYPTION_SECRET_PREVIOUS
 * (comma-separated, so more than one generation can be retired at once) and
 * are decrypt-only.
 *
 * This is what makes a leaked secret survivable. Rotation is: generate a new
 * secret, move the old value into AI_KEY_ENCRYPTION_SECRET_PREVIOUS, deploy.
 * Stored keys keep working immediately and are re-encrypted under the new
 * secret as they are used, so the old one can be dropped once traffic has
 * turned over. Read lazily rather than at module load so that importing this
 * module -- which Next does while building routes, and vitest does while
 * collecting tests -- doesn't hard-fail an environment that simply hasn't
 * configured the feature.
 */
function getKeys(): Buffer[] {
  if (cachedKeys) return cachedKeys;

  const raw = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!raw) {
    throw new Error(
      "AI_KEY_ENCRYPTION_SECRET is not set -- required to store AI provider API keys.",
    );
  }

  const keys = [decodeSecret(raw, "AI_KEY_ENCRYPTION_SECRET")];

  const previous = process.env.AI_KEY_ENCRYPTION_SECRET_PREVIOUS;
  if (previous) {
    for (const entry of previous.split(",")) {
      const trimmed = entry.trim();
      if (trimmed) keys.push(decodeSecret(trimmed, "AI_KEY_ENCRYPTION_SECRET_PREVIOUS"));
    }
  }

  cachedKeys = keys;
  return keys;
}

/** The secret new ciphertext is written under. */
function currentKey(): Buffer {
  return getKeys()[0];
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
    getKeys();
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forces the next call to re-read the environment. */
export function resetEncryptionKeyCache(): void {
  cachedKeys = null;
}

/**
 * Encrypts a plaintext secret. Output is safe to store in a text column.
 *
 * Format: `v2.<iv>.<authTag>.<ciphertext>`, each part base64.
 *
 * **`owner` is bound into the ciphertext** as GCM additional authenticated
 * data. It is not encrypted and not secret -- it is authenticated, which means
 * decryption fails unless the same value is supplied again. Pass the owning
 * user's id. That is what stops a ciphertext being lifted out of one row and
 * pasted into another: the attacker would need the encryption secret to
 * re-encrypt it under the new owner, and if they had that they would not need
 * the transplant.
 *
 * The auth tag is what makes this AEAD rather than plain encryption: decrypt()
 * refuses ciphertext that has been altered, so write access to the database
 * cannot be used to swap in an attacker-controlled key undetected either.
 */
export function encrypt(plaintext: string, owner: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, currentKey(), iv);
  cipher.setAAD(Buffer.from(owner, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    CURRENT_FORMAT,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export interface DecryptResult {
  plaintext: string;
  /**
   * True when this value should be written back re-encrypted: it is still in
   * the v1 format, or it decrypted under a retired secret rather than the
   * current one. Callers that can write use it to migrate opportunistically
   * (see queries.ts); callers that can't may ignore it.
   */
  stale: boolean;
}

/**
 * Decrypts what encrypt() produced, and reports whether it needs rewriting.
 *
 * Tries the current secret first, then any retired ones, so a rotation does
 * not lock anybody out of their own stored keys.
 *
 * Every failure path throws the same generic message. The caller cannot
 * distinguish "wrong key" from "corrupted ciphertext" from "bad auth tag" from
 * "wrong owner" -- deliberately, since distinguishing them is exactly the
 * oracle that turns a decryption endpoint into a padding-oracle-style attack
 * surface. The specific cause is a server-side debugging concern, not
 * something to hand back.
 */
export function decryptWithMeta(ciphertext: string, owner: string): DecryptResult {
  const parts = ciphertext.split(".");
  const version = parts[0];
  if (parts.length !== 4 || (version !== FORMAT_V1 && version !== FORMAT_V2)) {
    throw new Error("Could not decrypt stored API key.");
  }

  const [, ivB64, authTagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  // Node throws a confusing error for a wrong-length tag; checking up front
  // keeps the single generic failure mode above.
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("Could not decrypt stored API key.");
  }

  const keys = getKeys();
  for (let i = 0; i < keys.length; i++) {
    try {
      const decipher = createDecipheriv(ALGORITHM, keys[i], iv);
      // v1 predates owner binding and authenticates no AAD. It is accepted so
      // that keys already stored in production keep working, and re-encrypted
      // to v2 on the way past.
      if (version === FORMAT_V2) decipher.setAAD(Buffer.from(owner, "utf8"));
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
      return { plaintext, stale: version !== CURRENT_FORMAT || i !== 0 };
    } catch {
      // Wrong secret, wrong owner, or tampered input -- indistinguishable by
      // design. Try the next retired secret before giving up.
    }
  }

  throw new Error("Could not decrypt stored API key.");
}

/** Plaintext only, for callers with nothing to do about staleness. */
export function decrypt(ciphertext: string, owner: string): string {
  return decryptWithMeta(ciphertext, owner).plaintext;
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
