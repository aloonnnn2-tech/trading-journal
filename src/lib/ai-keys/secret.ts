// A user's decrypted API key, wrapped so it cannot be printed by accident.
//
// The plaintext lives in a module-private WeakMap, not on the object: an
// accidental console.log, JSON.stringify, template string, object spread,
// structuredClone, Sentry "extra" or error message sees "[redacted]" or
// nothing at all. The only way out is reveal(), and the only callers are the
// provider adapters building an auth header (and the redaction of provider
// error text, which needs the exact string to remove it).
//
// Deliberately NOT server-only: the provider adapters import it and their
// tests run in plain Node. Nothing here holds a secret until the server has
// decrypted one.

const vault = new WeakMap<SecretKey, string>();

export class SecretKey {
  constructor(plaintext: string) {
    vault.set(this, plaintext);
    Object.freeze(this);
  }

  /** The key itself. Call only where it goes into a provider request header. */
  reveal(): string {
    const v = vault.get(this);
    if (v === undefined) throw new Error("SecretKey has no value");
    return v;
  }

  toString(): string {
    return "[redacted]";
  }

  toJSON(): string {
    return "[redacted]";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "SecretKey([redacted])";
  }
}

/** A key as the provider adapters accept it: the typed-in string (when a key
 *  is first checked, before it is stored) or a decrypted SecretKey. */
export type KeyInput = string | SecretKey;

export function reveal(key: KeyInput): string {
  return typeof key === "string" ? key : key.reveal();
}

/**
 * Removes a key's exact text from `text` -- provider error bodies, which is
 * the one place a key could come back to us (some providers echo part of a
 * bad credential). Catches keys with no recognisable prefix, which the
 * pattern-based scrubber cannot.
 */
export function redactKey(text: string, key: KeyInput | undefined): string {
  if (!key) return text;
  const k = reveal(key);
  if (k.length < 8) return text;
  let out = text.split(k).join("[redacted-key]");
  // Providers sometimes echo a key trimmed at either end; remove any long
  // enough fragment of it too.
  for (const size of [24, 16]) {
    if (k.length <= size) continue;
    for (let i = 0; i + size <= k.length; i += 4) out = out.split(k.slice(i, i + size)).join("[redacted-key]");
  }
  return out;
}
