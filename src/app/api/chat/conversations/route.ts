import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { isEncryptionConfigured } from "@/lib/ai-keys/crypto";
import { providerModel } from "@/lib/ai-keys/providers";
import type { AIProviderName } from "@/lib/ai-keys/types";
import { createConversation, listConversations } from "@/lib/chat/queries";
import { rateLimit } from "@/lib/rate-limit";

// Conversations are cheap rows, but a create resolves a stored key, so a
// looping client shouldn't be able to churn them.
const CREATE_LIMIT = 30;
const WINDOW_MS = 60_000;

export async function GET() {
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  const items = await listConversations(gate.supabase);
  return NextResponse.json({ items });
}

const createSchema = z.object({
  // The stored key this conversation will use. Its provider and model are
  // recorded on the conversation, so switching keys later is explicit.
  keyId: z.uuid(),
});

export async function POST(request: Request) {
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;

  const limit = await rateLimit(`chat-create:${gate.userId}`, CREATE_LIMIT, WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many new conversations in a row. Give it a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { keyId }" }, { status: 400 });
  }

  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      { error: "AI features aren't configured on this server yet (missing AI_KEY_ENCRYPTION_SECRET)." },
      { status: 503 },
    );
  }

  // Resolves under RLS, so another user's key id is simply not found. Only
  // the provider is needed here, so the key is never decrypted: the fewer
  // call frames that ever hold plaintext, the better.
  const { data: stored, error } = await gate.supabase
    .from("user_api_keys")
    .select("provider")
    .eq("id", parsed.data.keyId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!stored) {
    return NextResponse.json({ error: "That key isn't available. Pick another, or add one." }, { status: 400 });
  }
  const provider = stored.provider as AIProviderName;

  const conversation = await createConversation(gate.supabase, gate.userId, {
    provider,
    model: providerModel(provider),
    keyId: parsed.data.keyId,
  });
  return NextResponse.json(conversation, { status: 201 });
}
