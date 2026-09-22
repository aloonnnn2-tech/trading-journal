import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { recordConsent } from "@/lib/ai-keys/consent";
import { SELECTABLE_PROVIDERS } from "@/lib/ai-keys/types";

// `scope` defaults to the original meaning so the review pages, which do not
// send one, are unchanged. The chat sends "chat_v2" -- see consent.ts.
// Consent to a retired provider is refused for the same reason a key for one
// is: nothing could ever be sent to it.
const consentSchema = z.object({
  provider: z.enum(SELECTABLE_PROVIDERS),
  scope: z.enum(["journal_v1", "chat_v2"]).default("journal_v1"),
});

// Records that the user agreed to send their journal to one named provider.
// Separate from the ask endpoint on purpose: consent is its own event with its
// own timestamp, and folding it into "ask" would make every question an
// implicit re-agreement, which is not what agreeing once means.
export async function POST(request: Request) {
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = consentSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  await recordConsent(gate.supabase, gate.userId, parsed.data.provider, parsed.data.scope);
  return NextResponse.json({ ok: true });
}
