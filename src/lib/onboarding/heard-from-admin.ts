import type { SupabaseClient } from "@supabase/supabase-js";
import { heardFromLabel } from "./heard-from";

// Admin only. Takes a SERVICE-ROLE client (createAdminClient): the answers live
// in auth user metadata, which nothing else can read. The caller must already
// have proved the requester is an admin.

export interface HeardFromRow {
  /** The stored answer ("tiktok", "skipped"), or null. */
  answer: string | null;
  /** "TikTok", "Skipped", or null when the account was never asked. */
  heardFrom: string | null;
  /** The first visit's utm_source or referring site, from sign-up (Round 2). */
  signupSource: string | null;
}

export async function getHeardFromByUser(admin: SupabaseClient): Promise<Map<string, HeardFromRow>> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const out = new Map<string, HeardFromRow>();
  for (const u of data.users) {
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const source = meta.signup_source ?? meta.signup_referrer;
    out.set(u.id, {
      answer: typeof meta.heard_from === "string" ? meta.heard_from : null,
      heardFrom: heardFromLabel(meta.heard_from),
      signupSource: typeof source === "string" ? source : null,
    });
  }
  return out;
}
