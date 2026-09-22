import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIProviderName } from "./types";

// Per-provider record that the user agreed to send their journal to a given
// third party. Backed by ai_provider_consents (0031, scope added in 0047),
// owner-scoped by RLS.
//
// Per PROVIDER, not per user: agreeing to send data to Groq says nothing about
// sending the same data to OpenAI. The previous browser-local flag covered the
// user as a whole, so switching providers silently reused an agreement that
// named a different company.
//
// Per SCOPE, since 0047: what is disclosed differs by feature. The AI review
// routes send a bounded, per-request slice of the journal ("journal_v1"). The
// chat gives the model live lookups across every table, persists the
// conversation, sends screenshots on capable providers and proposes writes
// ("chat_v2"). Consent to the first does not cover the second, so the chat
// asks again with its own wording in front of the user. Defaulting the
// parameter keeps every existing caller on the original meaning untouched.

export type ConsentScope = "journal_v1" | "chat_v2";

export async function listConsentedProviders(
  supabase: SupabaseClient,
  scope: ConsentScope = "journal_v1",
): Promise<AIProviderName[]> {
  const { data, error } = await supabase
    .from("ai_provider_consents")
    .select("provider")
    .eq("scope", scope);
  if (error) throw error;
  return (data ?? []).map((row) => row.provider as AIProviderName);
}

export async function hasConsent(
  supabase: SupabaseClient,
  provider: AIProviderName,
  scope: ConsentScope = "journal_v1",
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ai_provider_consents")
    .select("provider")
    .eq("provider", provider)
    .eq("scope", scope)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function recordConsent(
  supabase: SupabaseClient,
  userId: string,
  provider: AIProviderName,
  scope: ConsentScope = "journal_v1",
): Promise<void> {
  // Idempotent: re-agreeing is not an error, and the original accepted_at is
  // the one worth keeping, so an existing row is left exactly as it is.
  const { error } = await supabase
    .from("ai_provider_consents")
    .upsert(
      { user_id: userId, provider, scope },
      { onConflict: "user_id,provider,scope", ignoreDuplicates: true },
    );
  if (error) throw error;
}
