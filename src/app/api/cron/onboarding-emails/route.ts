import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverSecret } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSender } from "@/lib/email/send";
import { runOnboardingEmails } from "@/lib/email/run-onboarding";

// The day-0 welcome and day-2 nudge emails (src/lib/email/onboarding.ts).
// Called hourly by netlify/functions/onboarding-emails-cron.mts with
// CRON_SECRET, the same way /api/cron/auto-execute is. `?dryRun=1` reports
// who would get what without sending or recording anything.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secret = serverSecret("CRON_SECRET");
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!provided || !secretMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const send = emailSender();
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1" || send === null;

  try {
    const result = await runOnboardingEmails({ admin: createAdminClient(), send, secret, now: new Date(), dryRun });
    return NextResponse.json({ ...result, senderConfigured: send !== null });
  } catch (err) {
    console.error("[cron/onboarding-emails]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Run failed" }, { status: 500 });
  }
}
