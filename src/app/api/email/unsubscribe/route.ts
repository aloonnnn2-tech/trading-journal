import { NextResponse } from "next/server";
import { serverSecret } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { readOnboardingState, writeOnboardingState } from "@/lib/email/onboarding";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

// Opts an account out of onboarding emails. Two callers:
//   * the mailbox's one-click "Unsubscribe" button (RFC 8058): a POST to the
//     List-Unsubscribe URL, u and t in the query, body
//     "List-Unsubscribe=One-Click"; answered with a bare 200;
//   * the Unsubscribe button on /unsubscribe: a form POST with u and t,
//     redirected back to that page to show it worked.
// Only POST: a GET would let link scanners unsubscribe people by preloading.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = new URL(request.url);
  let form: FormData | null = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const field = (name: string) => {
    const v = form?.get(name);
    return typeof v === "string" ? v : (url.searchParams.get(name) ?? "");
  };
  const userId = field("u");
  const token = field("t");
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";

  const secret = serverSecret("CRON_SECRET");
  if (!secret || !verifyUnsubscribeToken(userId, token, secret)) {
    return oneClick
      ? NextResponse.json({ error: "Invalid link" }, { status: 400 })
      : NextResponse.redirect(new URL("/unsubscribe?error=1", url), 303);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  let ok = !error && !!data.user;
  if (ok && data.user) {
    const base = (data.user.app_metadata ?? {}) as Record<string, unknown>;
    const state = readOnboardingState(base);
    const res = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { ...base, ...writeOnboardingState({ ...state, optedOut: true }) },
    });
    ok = !res.error;
  }

  if (oneClick) return ok ? new NextResponse("Unsubscribed", { status: 200 }) : new NextResponse("Failed", { status: 500 });
  return NextResponse.redirect(new URL(ok ? "/unsubscribe?done=1" : "/unsubscribe?error=1", url), 303);
}
