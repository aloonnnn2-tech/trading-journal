import type { SupabaseClient } from "@supabase/supabase-js";
import type { HelpStatus } from "./config";

// The help requests table (0075) is service-role only; these run with the
// admin client, behind the admin gate, and nowhere else.

export interface HelpRequestRow {
  id: string;
  user_id: string | null;
  email: string;
  name: string | null;
  topic: string;
  message: string;
  page: string | null;
  status: HelpStatus;
  created_at: string;
  handled_at: string | null;
}

/** Newest first. Far more than this would mean the form is being flooded. */
export const HELP_PAGE_CAP = 500;

const COLUMNS = "id, user_id, email, name, topic, message, page, status, created_at, handled_at";

export async function listHelpRequests(
  admin: SupabaseClient,
  filter: "open" | "all",
): Promise<{ requests: HelpRequestRow[]; openCount: number }> {
  let query = admin.from("help_requests").select(COLUMNS).order("created_at", { ascending: false }).limit(HELP_PAGE_CAP);
  if (filter === "open") query = query.eq("status", "open");
  const [{ data, error }, open] = await Promise.all([
    query,
    admin.from("help_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  if (error) throw error;
  if (open.error) throw open.error;
  return { requests: (data ?? []) as HelpRequestRow[], openCount: open.count ?? 0 };
}

/** True if the request existed. Marks when it was handled; reopening clears that. */
export async function setHelpStatus(admin: SupabaseClient, id: string, status: HelpStatus): Promise<boolean> {
  const { data, error } = await admin
    .from("help_requests")
    .update({ status, handled_at: status === "open" ? null : new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function deleteHelpRequest(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await admin.from("help_requests").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Signed-in senders' account emails, for the admin list (id -> email). */
export async function accountEmails(admin: SupabaseClient, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of [...new Set(ids)].slice(0, 100)) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) out[id] = data.user.email;
  }
  return out;
}
