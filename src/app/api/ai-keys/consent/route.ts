import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { CONSENT_SCOPES, recordConsent, revokeConsent } from "@/lib/ai-keys/consent";
import { SELECTABLE_PROVIDERS } from "@/lib/ai-keys/types";

// `scope` defaults to the original meaning so the review pages, which do not
// send one, are unchanged. The chat sends "chat_v2" -- see consent.ts.
// Consent to a retired provider is refused for the same reason a key for one
// is: nothing could ever be sent to it.
const consentSchema = z.object({
  provider: z.enum(SELECTABLE_PROVIDERS),
  scope: z.enum(CONSENT_SCOPES).default("journal_v1"),
});

// Withdrawing is offered for chart screenshots only, from the switch under
// the chat box. RLS scopes the delete to the caller's own rows.
const revokeSchema = z.object({
  provider: z.enum(SELECTABLE_PROVIDERS),
  scope: z.literal("chat_images_v1"),
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

export async function DELETE(request: Request) {
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = revokeSchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: "Unknown provider or scope" }, { status: 400 });

  await revokeConsent(gate.supabase, parsed.data.provider, parsed.data.scope);
  return NextResponse.json({ ok: true });
}
