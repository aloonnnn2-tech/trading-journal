import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { buildCustomFieldsSchema } from "@/lib/fields/schema";
import { listFieldDefinitions, listFieldDefinitionsForStrategies } from "@/lib/fields/definitions";
import { coreFieldsSchema } from "@/lib/trades/schema";
import { deleteTrade, getTrade, updateTrade } from "@/lib/trades/queries";
import { EDITABLE_CORE_FIELDS, type EditableCoreField } from "@/lib/trades/types";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { enforceRateLimit } from "@/lib/rate-limit";

function pickEditableCore(input: unknown): Partial<Record<EditableCoreField, unknown>> {
  if (typeof input !== "object" || input === null) return {};
  const result: Partial<Record<EditableCoreField, unknown>> = {};
  for (const key of EDITABLE_CORE_FIELDS) {
    if (key in input) {
      result[key] = (input as Record<string, unknown>)[key];
    }
  }
  return result;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // **Deliberately loose.** This is the autosave endpoint: the trade form
  // debounces at 600ms and fires a PATCH per pause in typing, so a genuinely
  // busy editing session can produce a request every second or two for
  // minutes on end, and a limit tuned for "a user clicking" would break
  // ordinary use -- silently, since a dropped autosave looks like data loss.
  // 240/min leaves roughly a 4x margin over the fastest realistic typing and
  // still caps a runaway client.
  const limited = enforceRateLimit(
    `trade-update:${userId}`,
    240,
    60_000,
    "Your edits are being saved faster than we can accept them. Pause for a moment -- your latest changes will save.",
  );
  if (limited) return limited;

  const supabase = await createClient();

  const existing = await getTrade(supabase, id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Unguarded, this was the one place a truncated body from a flaky mobile
  // connection turned into an unhandled 500 -- and it's the autosave hot
  // path, hit every 600ms while editing. A parse failure is the client's
  // fault: 400, not 500.
  let body: { core?: unknown; customFields?: unknown; strategyFieldValues?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsedCore = coreFieldsSchema.safeParse(pickEditableCore(body.core));
  if (!parsedCore.success) {
    return NextResponse.json({ error: parsedCore.error.flatten() }, { status: 400 });
  }
  const core = parsedCore.data;

  let customFields: Record<string, unknown> | undefined;
  if (body.customFields) {
    const fieldDefinitions = await listFieldDefinitions(supabase, existing.mode);
    const schema = buildCustomFieldsSchema(fieldDefinitions);
    const parsed = schema.safeParse(body.customFields);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    customFields = parsed.data;
  }

  let strategyFieldValues: Record<string, Record<string, unknown>> | undefined;
  if (body.strategyFieldValues && typeof body.strategyFieldValues === "object") {
    const entries = Object.entries(body.strategyFieldValues as Record<string, unknown>);
    // One query for every touched strategy's fields, rather than one
    // round trip per strategy -- matters once a trade carries several.
    const fieldsByStrategy = await listFieldDefinitionsForStrategies(
      supabase,
      existing.mode,
      entries.map(([strategyId]) => strategyId),
    );
    strategyFieldValues = {};
    for (const [strategyId, values] of entries) {
      const schema = buildCustomFieldsSchema(fieldsByStrategy[strategyId] ?? []);
      const parsed = schema.safeParse(values);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }
      strategyFieldValues[strategyId] = parsed.data;
    }
  }

  let updated;
  try {
    updated = await updateTrade(supabase, id, { core, customFields, strategyFieldValues });
  } catch (err) {
    // Log the real failure and surface its Postgres/PostgREST code (safe --
    // it's an identifier, not data). Previously every cause collapsed into
    // one generic message, making a schema-drift failure indistinguishable
    // from bad input on both sides of the wire.
    console.error("updateTrade failed", { tradeId: id, err });
    const code = (err as { code?: string }).code;
    return NextResponse.json({ error: "Failed to update trade", code: code ?? null }, { status: 400 });
  }
  void logEvent(supabase, userId, SERVER_SESSION_ID, "trade_edited", { tradeId: id });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Deletes are confirm-dialog-gated in the UI, so a burst of them is not a
  // person. Tighter than the autosave limit above for that reason.
  const limited = enforceRateLimit(
    `trade-delete:${userId}`,
    60,
    60_000,
    "Too many deletions in a row. Wait a moment and try again.",
  );
  if (limited) return limited;

  const supabase = await createClient();

  const deleted = await deleteTrade(supabase, id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  void logEvent(supabase, userId, SERVER_SESSION_ID, "trade_deleted", { tradeId: id });
  return NextResponse.json({ ok: true });
}
