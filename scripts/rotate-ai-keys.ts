// Re-encrypts every stored AI provider key under the CURRENT secret, in the
// current (v3) format -- bound to its owner, its own row and its provider.
//
//   npm run rotate:ai-keys            dry run: reports what would change
//   npm run rotate:ai-keys -- --apply writes
//
// When to run it:
//   * after rotating AI_KEY_ENCRYPTION_SECRET (old value moved to
//     AI_KEY_ENCRYPTION_SECRET_PREVIOUS) -- keys are otherwise only rewritten
//     when they're next used, so idle keys stay under the old secret and it
//     can never be dropped;
//   * once after deploying the v3 format, to upgrade every v2 key at once.
//
// Reads .env.local (service-role key + both secrets). Never prints a key, a
// ciphertext or a secret: only row counts and ids. A key that doesn't
// decrypt under any configured secret is reported and left untouched.

import { createClient } from "@supabase/supabase-js";
import { decryptWithMeta, encrypt } from "../src/lib/ai-keys/crypto";

const apply = process.argv.includes("--apply");
if (process.env.AI_KEY_WRITE_V3 !== "true") {
  console.log('  Note: AI_KEY_WRITE_V3 is not "true", so keys are rewritten as v2 under the current secret.');
  console.log("  Switch it on only after the code that reads v3 is deployed (SECURITY-RUNBOOK.md).");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).");
  process.exit(2);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const { data, error } = await db.from("user_api_keys").select("id, user_id, provider, encrypted_key");
  if (error) {
    console.error(`✗ Couldn't read user_api_keys: ${error.message}`);
    process.exit(2);
  }
  const rows = (data ?? []) as { id: string; user_id: string; provider: string; encrypted_key: string }[];
  let current = 0;
  let rewritten = 0;
  const failed: string[] = [];

  for (const row of rows) {
    const binding = { keyId: row.id, provider: row.provider };
    let plaintext: string;
    let stale: boolean;
    try {
      ({ plaintext, stale } = decryptWithMeta(row.encrypted_key, row.user_id, binding));
    } catch {
      failed.push(row.id);
      continue;
    }
    if (!stale) {
      current += 1;
      continue;
    }
    if (apply) {
      const { error: writeError } = await db
        .from("user_api_keys")
        .update({ encrypted_key: encrypt(plaintext, row.user_id, binding) })
        .eq("id", row.id)
        .eq("user_id", row.user_id);
      if (writeError) {
        failed.push(row.id);
        continue;
      }
    }
    rewritten += 1;
  }

  console.log(`  ${rows.length} keys: ${current} already current, ${rewritten} ${apply ? "re-encrypted" : "would be re-encrypted"}.`);
  if (failed.length > 0) {
    console.log(`  ✗ ${failed.length} could not be decrypted with any configured secret (left untouched):`);
    for (const id of failed) console.log(`    ${id}`);
  }
  if (!apply && rewritten > 0) console.log("  Dry run. Re-run with -- --apply to write.");
  // exitCode, not exit(): exiting with open handles trips a libuv assertion on Windows.
  process.exitCode = failed.length > 0 ? 1 : 0;
}

void main();
