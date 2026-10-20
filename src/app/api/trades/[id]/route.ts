import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { buildCustomFieldsSchema } from "@/lib/fields/schema";
import { listFieldDefinitions, listFieldDefinitionsForStrategies } from "@/lib/fields/definitions";
import { coreFieldsSchema } from "@/lib/trades/schema";
import { deleteTrade, getTrade, TradeConflictError, updateTrade } from "@/lib/trades/queries";
import { pickEditableCore } from "@/lib/trades/pick-core";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/observability/log";

const patchEnvelopeSchema = z
  .object({
    core: z.unknown().optional(),
    customFields: z.unknown().optional(),
    strategyFieldValues: z.unknown().optional(),
    // The last value this page saw for each field it is changing (same
    // shape as the three above). Optional: without it nothing is checked.
    // See src/lib/trades/conflicts.ts.
    base: z
      .object({
        core: z.record(z.string(), z.unknown()).optional(),
        customFields: z.record(z.string(), z.unknown()).optional(),
        strategyFieldValues: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      })
      .optional(),
  })
  .strict();

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
  const limited = await enforceRateLimit(
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
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // The envelope. Each part is validated in detail below; this refuses
  // anything that is not the object the autosave sends (an array used to be
  // read as "no changes" and answered 200).
  const envelope = patchEnvelopeSchema.safeParse(rawBody);
  if (!envelope.success) {
    return NextResponse.json({ error: "Expected { core, customFields, strategyFieldValues }" }, { status: 400 });
  }
  const body = envelope.data;

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
    updated = await updateTrade(supabase, id, { core, customFields, strategyFieldValues }, { base: body.base });
  } catch (err) {
    // Never a silent overwrite: the page shows what changed and lets the
    // user keep theirs or take the saved version.
    if (err instanceof TradeConflictError) {
      return NextResponse.json(
        {
          error: "This trade was changed somewhere else while you were editing it.",
          conflict: err.fields,
          trade: err.current,
        },
        { status: 409 },
      );
    }
    // Log the real failure and surface its Postgres/PostgREST code (safe --
    // it's an identifier, not data). Previously every cause collapsed into
    // one generic message, making a schema-drift failure indistinguishable
    // from bad input on both sides of the wire.
    log.error("trades.update_failed", { tradeId: id, error: err });
    const code = (err as { code?: string }).code;
    return NextResponse.json({ error: "Failed to update trade", code: code ?? null }, { status: 400 });
  }
  void logEvent(userId, SERVER_SESSION_ID, "trade_edited", { tradeId: id });
  return NextResponse.json(updated);
}

// The trade as it is saved now. The trade page re-reads it when its tab
// comes back into view, so an order the background sweep filled meanwhile
// is the state the next edit is checked against (use-autosave-trade.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await enforceRateLimit(
    `trade-read:${userId}`,
    240,
    60_000,
    "Too many requests in a row. Wait a moment and try again.",
  );
  if (limited) return limited;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  // RLS: someone else's trade simply doesn't resolve.
  const trade = await getTrade(supabase, id);
  if (!trade) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(trade, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Deletes are confirm-dialog-gated in the UI, so a burst of them is not a
  // person. Tighter than the autosave limit above for that reason.
  const limited = await enforceRateLimit(
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
  void logEvent(userId, SERVER_SESSION_ID, "trade_deleted", { tradeId: id });
  return NextResponse.json({ ok: true });
}
