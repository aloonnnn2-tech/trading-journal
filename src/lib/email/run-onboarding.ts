import type { SupabaseClient, User } from "@supabase/supabase-js";
import { accountGroup } from "@/lib/accounts/classify";
import { demoKeepsOwnTrades } from "@/lib/demo/keeps-own-trades";
import type { SendMail } from "./send";
import {
  onboardingEmail,
  pickOnboardingEmail,
  readOnboardingState,
  writeOnboardingState,
  type OnboardingEmailKind,
  type OnboardingEmailState,
} from "./onboarding";
import { oneClickUnsubscribeUrl, unsubscribeUrl } from "./unsubscribe-token";

/** Brevo free allows 300 a day; an hourly run never needs anywhere near this. */
export const MAX_SENDS_PER_RUN = 40;

export interface OnboardingRunResult {
  dryRun: boolean;
  welcome: number;
  nudge: number;
  /** Due a nudge but already logged a trade of their own. */
  nudgeNotNeeded: number;
  failures: string[];
}

interface Options {
  /** Service-role client: reads every account, writes app_metadata. */
  admin: SupabaseClient;
  /** Null in a dry run. */
  send: SendMail | null;
  secret: string;
  now: Date;
  dryRun: boolean;
}

async function listAllUsers(admin: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function excludedIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin.from("user_settings").select("user_id").eq("excluded_from_analytics", true);
  // Unknown exclusions: treat the run as unsafe rather than mail test accounts.
  if (error) throw error;
  return new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
}

/** True when the account has a trade it logged itself (demo rows don't count). */
async function hasOwnTrade(admin: SupabaseClient, userId: string, demoMarked: boolean): Promise<boolean> {
  let q = admin.from("trades").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (demoMarked) q = q.eq("is_demo", false);
  const { count, error } = await q;
  // Can't tell: say yes, so nobody is nudged about a trade they did log.
  if (error) return true;
  return (count ?? 0) > 0;
}

/**
 * Sends whatever onboarding email each account is due. Records the send on
 * the account BEFORE sending and undoes the record if the send is refused, so a
 * failed write can never cause the same email to go out every hour.
 */
export async function runOnboardingEmails({ admin, send, secret, now, dryRun }: Options): Promise<OnboardingRunResult> {
  const result: OnboardingRunResult = { dryRun, welcome: 0, nudge: 0, nudgeNotNeeded: 0, failures: [] };
  const [users, excluded] = await Promise.all([listAllUsers(admin), excludedIds(admin)]);
  let demoMarked: boolean | null = null;
  let sends = 0;

  for (const u of users) {
    if (sends >= MAX_SENDS_PER_RUN) break;
    if (!u.email) continue;
    const group = accountGroup(u.email);
    const state = readOnboardingState(u.app_metadata);
    const due = pickOnboardingEmail(
      {
        createdAt: u.created_at,
        emailConfirmedAt: u.email_confirmed_at ?? null,
        state,
        excluded: excluded.has(u.id) || group === "keep" || group === "test",
      },
      now,
    );
    if (!due) continue;

    let kind: OnboardingEmailKind = "welcome";
    if (due === "nudge-if-no-trade") {
      demoMarked ??= await demoKeepsOwnTrades(admin);
      if (await hasOwnTrade(admin, u.id, demoMarked)) {
        result.nudgeNotNeeded++;
        continue;
      }
      kind = "nudge";
    }

    sends++;
    if (dryRun || !send) {
      result[kind]++;
      continue;
    }

    const stamp = now.toISOString();
    const next: OnboardingEmailState =
      kind === "welcome" ? { ...state, welcomeSentAt: stamp } : { ...state, nudgeSentAt: stamp };
    const base = (u.app_metadata ?? {}) as Record<string, unknown>;
    const claim = await admin.auth.admin.updateUserById(u.id, {
      app_metadata: { ...base, ...writeOnboardingState(next) },
    });
    if (claim.error) {
      result.failures.push(`${u.id}: could not record (${claim.error.message})`);
      continue;
    }

    const mail = onboardingEmail(kind, unsubscribeUrl(u.id, secret));
    try {
      await send({
        to: u.email,
        subject: mail.subject,
        text: mail.text,
        headers: {
          "List-Unsubscribe": `<${oneClickUnsubscribeUrl(u.id, secret)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      result[kind]++;
    } catch (err) {
      result.failures.push(`${u.id}: ${kind} not sent (${err instanceof Error ? err.message : String(err)})`);
      await admin.auth.admin.updateUserById(u.id, {
        app_metadata: { ...base, ...writeOnboardingState(state) },
      });
    }
  }
  return result;
}
