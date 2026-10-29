import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { getTrade, PartialExitsError, TradeConflictError, updateTrade } from "@/lib/trades/queries";
import { partialExitInputSchema } from "@/lib/trades/partial-exits";
import type { PartialExit } from "@/lib/trades/types";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { log } from "@/lib/observability/log";

/**
 * Partial sells (0079): log, change or remove a sale of part of an open
 * position. Answers with the saved trade, P&L and fees recomputed.
 *
 *   POST   { sale }       log a sale
 *   PATCH  { id, sale }   change one
 *   DELETE { id }         remove one
 *
 * Its own route rather than an editable core field, so the list never rides
 * into CSV import/export or autosave, and every change is checked against
 * the whole trade (updateTrade -> partialExitsProblem): you can't sell more
 * than you hold. The RLS client limits it to the caller's own trades. Each
 * change is applied to the row as saved at that moment, so two sales logged
 * at once both land.
 */

const saleId = z.string().min(1).max(64);
const addSchema = z.object({ sale: partialExitInputSchema }).strict();
const updateSchema = z.object({ id: saleId, sale: partialExitInputSchema }).strict();
const deleteSchema = z.object({ id: saleId }).strict();

type Op = (current: PartialExit[]) => PartialExit[];

async function handle(
  request: Request,
  params: Promise<{ id: string }>,
  build: (body: unknown) => { op: Op } | { error: string },
) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

  // A person clicking a form, not autosave: far below the PATCH route's 240.
  const limited = await enforceRateLimit(
    `trade-partial-exit:${userId}`,
    60,
    60_000,
    "Too many changes in a row. Wait a moment and try again.",
  );
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const built = build(body);
  if ("error" in built) return NextResponse.json({ error: built.error }, { status: 400 });

  const supabase = await createClient();
  const existing = await getTrade(supabase, id);
  if (!existing) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  // The row is read with select("*"): no key means 0079 isn't applied.
  if (!Object.prototype.hasOwnProperty.call(existing, "partial_exits")) {
    return NextResponse.json(
      { error: "Partial sells aren't switched on yet (migration 0079 still needs to be run)." },
      { status: 503 },
    );
  }

  try {
    const updated = await updateTrade(supabase, id, { partialExits: built.op });
    void logEvent(userId, SERVER_SESSION_ID, "trade_edited", { tradeId: id });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof PartialExitsError || err instanceof SaleNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: err instanceof SaleNotFoundError ? 404 : 400 });
    }
    if (err instanceof TradeConflictError) {
      return NextResponse.json({ error: "The trade kept changing. Try again.", trade: err.current }, { status: 409 });
    }
    log.error("trades.partial_exit_failed", { tradeId: id, error: err });
    return NextResponse.json({ error: "Could not save that sale." }, { status: 500 });
  }
}

class SaleNotFoundError extends Error {
  constructor() {
    super("That sale was already removed.");
    this.name = "SaleNotFoundError";
  }
}

function invalid(error: z.ZodError): { error: string } {
  const first = error.issues[0];
  const where = first?.path.filter((p) => p !== "sale").join(".");
  return { error: first ? `${where ? `${where}: ` : ""}${first.message}` : "Invalid sale" };
}

function clean(sale: z.infer<typeof partialExitInputSchema>) {
  return {
    date: new Date(sale.date).toISOString(),
    shares: sale.shares,
    price: sale.price,
    reason: sale.reason,
    note: sale.note?.trim() ? sale.note.trim() : null,
    fee: sale.fee ?? null,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, (body) => {
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    const sale: PartialExit = { id: crypto.randomUUID(), ...clean(parsed.data.sale) };
    return { op: (current) => [...current, sale] };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, (body) => {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    const { id, sale } = parsed.data;
    return {
      op: (current) => {
        if (!current.some((s) => s.id === id)) throw new SaleNotFoundError();
        return current.map((s) => (s.id === id ? { id, ...clean(sale) } : s));
      },
    };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, (body) => {
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    const { id } = parsed.data;
    return {
      op: (current) => {
        if (!current.some((s) => s.id === id)) throw new SaleNotFoundError();
        return current.filter((s) => s.id !== id);
      },
    };
  });
}
