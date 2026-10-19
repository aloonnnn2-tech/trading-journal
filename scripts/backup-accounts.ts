/**
 * The account list for the backup (auth_users.json). Alon's decision,
 * 2026-10-19 (security gaps report, Q13 / G-22): without it, losing the
 * project lost every sign-in, and a restore couldn't reconnect anyone to
 * their journal.
 *
 * A fixed set of fields, never the whole user object: what a restore needs
 * (id, email, whether it was confirmed) and what tells you whose account it
 * was (sign-up and last sign-in dates, sign-in methods). Supabase's admin
 * API never returns password hashes; identity-provider ids and metadata are
 * left out on purpose.
 *
 * Its own module because backup-db.ts runs a backup when imported.
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";

export interface BackupAccount {
  id: string;
  email: string | null;
  email_confirmed_at: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  sign_in_methods: string[];
}

export function toBackupAccount(user: User): BackupAccount {
  const providers = (user.app_metadata as { providers?: unknown } | undefined)?.providers;
  return {
    id: user.id,
    email: user.email ?? null,
    email_confirmed_at: user.email_confirmed_at ?? null,
    created_at: user.created_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
    sign_in_methods: Array.isArray(providers) ? providers.filter((p): p is string => typeof p === "string") : [],
  };
}

const PER_PAGE = 1000;

export async function listAllAccounts(admin: SupabaseClient): Promise<BackupAccount[]> {
  const out: BackupAccount[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw error;
    out.push(...data.users.map(toBackupAccount));
    if (data.users.length < PER_PAGE) break;
  }
  return out;
}
