import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, KEY_CHECKS_PER_DAY, keyCheckDailyBucket } from "@/lib/ai-keys/limits";
import { chooseModel } from "@/lib/ai-keys/providers/model-check";
import { ProviderError, type AIProvider } from "@/lib/ai-keys/providers/types";
import { setApiKeyModel } from "@/lib/ai-keys/queries";
import type { SecretKey } from "@/lib/ai-keys/secret";
import type { AIProviderName } from "@/lib/ai-keys/types";
import { logError } from "@/lib/observability/scrub";
import { rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/observability/log";

/**
 * The model a key used has been retired by its provider. Re-pick from the
 * live list, skipping the dead one, and remember the pick for next time.
 * Null when nothing better is on offer (or the check itself failed).
 *
 * One place for the chat and the AI reviews, so a retired model costs the
 * user nothing on either -- the reviews used to fail until the key was
 * re-tested by hand.
 */
export interface RepickOptions {
  supabase: SupabaseClient;
  userId: string;
  keyId: string;
  providerName: AIProviderName;
  provider: AIProvider;
  key: SecretKey;
  model: string;
  logPrefix: string;
}

export async function repickRetiredModel(opts: RepickOptions): Promise<string | null> {
  const { supabase, userId, keyId, providerName, provider, key, model, logPrefix } = opts;
  try {
    // A re-check lists models with the key, so it counts against the same
    // daily cap as every other key check (fail closed).
    const daily = await rateLimit(keyCheckDailyBucket(userId), KEY_CHECKS_PER_DAY, DAY_MS, { failClosed: true });
    if (!daily.ok) return null;
    const check = await provider.validateKey(key);
    if (!check.valid) return null;
    const next = chooseModel(providerName, check.models.filter((m) => m !== model));
    if (next) await setApiKeyModel(supabase, keyId, next, { userId });
    log.warn("ai_keys.model_retired", { route: logPrefix, provider: providerName, model, switchedTo: next });
    return next;
  } catch (err) {
    logError(`[${logPrefix}] model re-pick failed:`, err);
    return null;
  }
}

/**
 * Runs `run` with the key's model; if the provider says that model is gone,
 * re-picks one and runs it once more -- when there is still time for it
 * before `deadlineAt`. Any other failure is rethrown untouched.
 */
export async function withRetiredModelRetry<T>(
  run: (model: string) => Promise<T>,
  opts: RepickOptions & { deadlineAt: number },
): Promise<T> {
  try {
    return await run(opts.model);
  } catch (err) {
    const retired = err instanceof ProviderError && err.failure === "model_missing";
    if (!retired || opts.deadlineAt - Date.now() < 8_000) throw err;
    const next = await repickRetiredModel(opts);
    if (!next || next === opts.model || opts.deadlineAt - Date.now() < 5_000) throw err;
    return run(next);
  }
}
