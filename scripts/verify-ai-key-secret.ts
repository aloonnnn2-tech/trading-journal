// Checks that AI_KEY_ENCRYPTION_SECRET is present, well-formed, and actually
// round-trips. Run with `npm run verify:ai-secret` (which reads .env.local),
// or point it at any environment by exporting the variable first.
//
// Never prints the secret or any part of it -- the whole point is that it can
// be run and its output pasted somewhere without leaking anything.

import { encrypt, decrypt, lastFour } from "../src/lib/ai-keys/crypto";

// Not a real credential: a fixed dummy string that merely looks key-shaped, so
// the mask output below is recognizable.
const SAMPLE = "sk-test-0000000000000000abcd";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const raw = process.env.AI_KEY_ENCRYPTION_SECRET;
if (!raw) {
  fail(
    "AI_KEY_ENCRYPTION_SECRET is not set.\n" +
      "  Generate one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n" +
      "  then add it to .env.local (locally) and to your Netlify environment variables.",
  );
}

// Report the shape without revealing the value, so a mistyped or truncated
// secret is diagnosable from this output alone.
const looksHex = /^[0-9a-fA-F]{64}$/.test(raw);
const decodedBytes = looksHex
  ? Buffer.from(raw, "hex").length
  : Buffer.from(raw, "base64").length;
console.log(`  format: ${looksHex ? "hex" : "base64"}, decodes to ${decodedBytes} bytes`);

let encrypted: string;
try {
  encrypted = encrypt(SAMPLE);
} catch (err) {
  fail((err as Error).message);
}

if (decrypt(encrypted) !== SAMPLE) {
  fail("Round-trip mismatch — encrypt/decrypt disagree. This should be impossible; report it.");
}

// Two encryptions of the same input must differ. If they don't, the per-call
// random IV has been broken, which breaks AES-GCM catastrophically rather
// than cosmetically -- worth failing loudly over.
if (encrypt(SAMPLE) === encrypt(SAMPLE)) {
  fail("Ciphertext is deterministic — the per-call IV is broken. Do not store real keys.");
}

console.log("✓ AI_KEY_ENCRYPTION_SECRET is valid and round-trips");
console.log(`  stored keys will display as: •••• ${lastFour(SAMPLE)}`);
console.log(
  "\n  Reminder: every environment sharing this Supabase database must use this\n" +
    "  exact same value, or keys saved in one can't be decrypted in the other.",
);
