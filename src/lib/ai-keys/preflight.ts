import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isEncryptionConfigured } from "./crypto";
import { getDecryptedKey } from "./queries";
import { hasConsent } from "./consent";
import type { AIProviderName } from "./types";

type Preflight =
  | { ok: true; provider: AIProviderName; key: string }
  | { ok: false; response: NextResponse };

/**
 * Everything that must be true before a single byte of a user's journal
 * leaves this server, in the order it has to be true in.
 *
 * Shared by every route that calls a provider (ask, trade review, period
 * review). Like guard.ts, this is factored out because it is a disclosure
 * control that must be identical everywhere: the route that skips the consent
 * check is the route that sends someone's trading history to a third party
 * they never agreed to.
 *
 * **Returns the decrypted key.** That value must go straight into the
 * provider call and nowhere else -- never into a response, a log, or an error.
 */
export async function preflightProviderCall(
  supabase: SupabaseClient,
  keyId: string,
  /**
   * The signed-in user. Used as the additional authenticated data the stored
   * ciphertext is bound to, so a key that was moved between rows in the
   * database will not decrypt here. Must be the id the gate verified, never
   * anything taken from the request body.
   */
  userId: string,
): Promise<Preflight> {
  // Checked before anything reaches the crypto module -- otherwise a
  // deployment missing the secret fails inside decrypt() as an unhandled
  // exception, i.e. a bare 500 with nothing to act on, at exactly the moment
  // a fresh deployment is most likely to be missing the variable.
  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "AI features aren't configured on this server yet (missing AI_KEY_ENCRYPTION_SECRET). Contact whoever deployed it.",
        },
        { status: 503 },
      ),
    };
  }

  // RLS scopes this to the caller, so another user's key id simply doesn't
  // resolve -- there is no way to run a request on someone else's key.
  const stored = await getDecryptedKey(supabase, keyId, userId);
  if (!stored) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "That key isn't available. Pick another one, or add a new key." },
        { status: 400 },
      ),
    };
  }

  // Enforced server-side, not only in the UI. This is the request that
  // actually discloses the journal to a third party, so it is the right place
  // to require the agreement -- a client that skipped the dialog, or a stale
  // tab from before consent was withdrawn, must not get through.
  let consented: boolean;
  try {
    consented = await hasConsent(supabase, stored.provider);
  } catch (err) {
    // Almost always the ai_provider_consents table not existing yet, i.e.
    // migration 0031 hasn't been applied. Fails CLOSED -- nothing is sent to
    // any provider -- and says what to do, rather than surfacing as the bare
    // 500 that an unhandled database error would produce.
    console.error("[ai] consent lookup failed:", err);
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "AI features aren't fully set up on this server yet (a database migration is pending). Contact whoever deployed it.",
        },
        { status: 503 },
      ),
    };
  }

  if (!consented) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `You haven't agreed to send your journal to ${stored.provider} yet.`,
          needsConsent: stored.provider,
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, provider: stored.provider, key: stored.key };
}
