import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { providerModel } from "@/lib/ai-keys/providers";
import type { AIProviderName } from "@/lib/ai-keys/types";
import { foldMessages } from "@/lib/chat/fold";
import {
  deleteConversation,
  getConversation,
  listMessages,
  updateConversation,
} from "@/lib/chat/queries";

type Params = { params: Promise<{ id: string }> };

// A non-UUID path segment used to reach Postgres as an invalid uuid literal
// and surface as a 500. It is a 404 like any other id that resolves to
// nothing -- and it costs no database round-trip.
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
const isUuid = (id: string) => z.uuid().safeParse(id).success;

// One conversation: its metadata plus the rows folded into what the UI
// renders. The raw tool payloads stay server-side; foldMessages carries only
// the activity labels and whether each call succeeded.
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;
  if (!isUuid(id)) return notFound();

  const conversation = await getConversation(gate.supabase, id);
  // 404 rather than 403 for someone else's id: RLS makes it simply not
  // resolve, and a 403 would confirm the id exists.
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await listMessages(gate.supabase, id, gate.userId);
  return NextResponse.json({ conversation, turns: foldMessages(rows) });
}

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).nullable().optional(),
    keyId: z.uuid().optional(),
  })
  .refine((v) => v.title !== undefined || v.keyId !== undefined, { message: "Nothing to change" });

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;
  if (!isUuid(id)) return notFound();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { title } and/or { keyId }" }, { status: 400 });
  }

  // A new key must be the caller's own and switched on. RLS confines the
  // lookup to their rows, so someone else's key id is simply not found; a
  // parked key is refused for the same reason the turn route refuses it.
  let key: { key_id: string; provider: AIProviderName; model: string } | undefined;
  if (parsed.data.keyId) {
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
    key = { key_id: parsed.data.keyId, provider, model: providerModel(provider) };
  }

  const updated = await updateConversation(gate.supabase, id, {
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    ...(key ? { key } : {}),
  });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;
  if (!isUuid(id)) return notFound();

  // Cascades to ai_messages via the foreign key.
  const deleted = await deleteConversation(gate.supabase, id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
