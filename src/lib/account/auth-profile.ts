import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * The sign-in record Supabase keeps for the account (auth.users), for the
 * "download all my data" file (security gaps pass, 5.4). The tables cover
 * the journal; without this the export left out the email address, when
 * the account was made and last signed in, and how it signs in.
 *
 * A fixed list of fields, never the whole record: the user object also
 * carries identity-provider ids and internal metadata that are no use to
 * the person and not worth a second copy on disk.
 */
export interface AuthProfile {
  email: string | null;
  email_confirmed_at: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  sign_in_methods: string[];
}

export function toAuthProfile(user: User): AuthProfile {
  const providers = (user.app_metadata as { providers?: unknown } | undefined)?.providers;
  return {
    email: user.email ?? null,
    email_confirmed_at: user.email_confirmed_at ?? null,
    created_at: user.created_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
    sign_in_methods: Array.isArray(providers) ? providers.filter((p): p is string => typeof p === "string") : [],
  };
}

/** Null when there is no service-role client or the lookup fails: the rest of the export still goes out. */
export async function getAuthProfile(admin: SupabaseClient | null, userId: string): Promise<AuthProfile | null> {
  if (!admin) return null;
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) return null;
    return toAuthProfile(data.user);
  } catch {
    return null;
  }
}
