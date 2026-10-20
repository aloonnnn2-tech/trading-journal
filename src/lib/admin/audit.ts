import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/observability/log";

// The admin / data-export audit trail (0072; security gaps pass, item 1.6).
//
// Who did what, to what, and when -- and nothing more. `target` is an id or a
// path; `detail` is a handful of small, flat values (a plan name, a flag).
// No trade contents, notes, emails or secrets ever go in: auditRow() drops
// anything that isn't a short scalar, so a careless caller can't leak them.
//
// Written through the service role only; nobody can read or write the table
// through the API (0072). An audit write NEVER blocks or fails the action it
// records -- a missing table (0072 not applied yet) or a database blip is
// logged and the request carries on.

export const AUDIT_ACTIONS = [
  "admin_page_view",
  "plan_change",
  "analytics_exclusion",
  "review_featured",
  "waitlist_export",
  "waitlist_remove",
  "account_export",
  "account_delete",
  "help_update",
  "help_remove",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  /** An id or a path. Never free text from a user. */
  target?: string | null;
  /** Small flat facts, e.g. { plan: "paid" }. Anything else is dropped. */
  detail?: Record<string, unknown>;
}

const MAX_TARGET = 200;
const MAX_DETAIL_KEYS = 8;
const MAX_DETAIL_STRING = 64;
const KEY = /^[a-z][a-z0-9_]{0,31}$/;

/** The row as stored: bounded, flat, and free of anything but short scalars. */
export function auditRow(entry: AuditEntry) {
  const detail: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(entry.detail ?? {}).slice(0, MAX_DETAIL_KEYS)) {
    if (!KEY.test(key)) continue;
    if (typeof value === "string") {
      if (value.length <= MAX_DETAIL_STRING) detail[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      detail[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      detail[key] = value;
    }
  }
  return {
    actor_id: entry.actorId,
    action: entry.action,
    target: entry.target ? entry.target.slice(0, MAX_TARGET) : null,
    detail: Object.keys(detail).length ? detail : null,
  };
}

/**
 * Records one entry. Never throws. `client` is for tests and for callers that
 * already hold the service-role client.
 */
export async function recordAudit(entry: AuditEntry, client?: SupabaseClient): Promise<void> {
  try {
    const admin = client ?? createAdminClient();
    const { error } = await admin.from("admin_audit_log").insert(auditRow(entry));
    if (error) log.warn("audit.write_failed", { action: entry.action, error });
  } catch (error) {
    log.warn("audit.write_failed", { action: entry.action, error });
  }
}
