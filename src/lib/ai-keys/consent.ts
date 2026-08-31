import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIProviderName } from "./types";

// Per-provider record that the user agreed to send their journal to a given
// third party. Backed by ai_provider_consents (0031), owner-scoped by RLS.
//
// Per PROVIDER, not per user: agreeing to send data to Groq says nothing about
// sending the same data to OpenAI. The previous browser-local flag covered the
// user as a whole, so switching providers silently reused an agreement that
// named a different company.

export async function listConsentedProviders(
  supabase: SupabaseClient,
): Promise<AIProviderName[]> {
  const { data, error } = await supabase.from("ai_provider_consents").select("provider");
  if (error) throw error;
  return (data ?? []).map((row) => row.provider as AIProviderName);
}

export async function hasConsent(
  supabase: SupabaseClient,
  provider: AIProviderName,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ai_provider_consents")
    .select("provider")
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function recordConsent(
  supabase: SupabaseClient,
  userId: string,
  provider: AIProviderName,
): Promise<void> {
  // Idempotent: re-agreeing is not an error, and the original accepted_at is
  // the one worth keeping, so an existing row is left exactly as it is.
  const { error } = await supabase
    .from("ai_provider_consents")
    .upsert({ user_id: userId, provider }, { onConflict: "user_id,provider", ignoreDuplicates: true });
  if (error) throw error;
}

export async function withdrawConsent(
  supabase: SupabaseClient,
  provider: AIProviderName,
): Promise<void> {
  const { error } = await supabase.from("ai_provider_consents").delete().eq("provider", provider);
  if (error) throw error;
}
