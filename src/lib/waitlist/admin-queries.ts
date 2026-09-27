import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaitlistRow } from "./csv";

// Reads and removals for the admin panel's Waitlist tab. Every function here
// takes the SERVICE-ROLE client -- the table has RLS on with no policies, so
// nothing else can see it -- and every caller must have checked isAdmin()
// against the caller's own RLS client first. See src/app/admin/waitlist.

export interface WaitlistEntry extends WaitlistRow {
  id: string;
}

/** Enough for any launch list this app will plausibly have; the page says so
 *  if the cap is ever reached rather than silently truncating. */
export const WAITLIST_PAGE_CAP = 5000;

export async function listWaitlist(
  admin: SupabaseClient,
): Promise<{ entries: WaitlistEntry[]; total: number }> {
  const { data, error, count } = await admin
    .from("waitlist")
    .select("id, email, source, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(WAITLIST_PAGE_CAP);
  if (error) throw error;
  return { entries: (data ?? []) as WaitlistEntry[], total: count ?? data?.length ?? 0 };
}

/** True if a row was removed, false if there was no such row. */
export async function removeWaitlistEntry(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await admin.from("waitlist").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
