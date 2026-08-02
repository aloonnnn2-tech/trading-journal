import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import {
  buildRowFromMapping,
  deriveStatusAndResult,
  withDerivedFields,
  type ImportTarget,
} from "@/lib/trades/import";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { listCommissionRules } from "@/lib/commissions/queries";
import { resolveCommission } from "@/lib/commissions/calculate";

const BATCH_SIZE = 500;

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // A malformed body is a client mistake, not a server fault -- parsing it
  // unguarded turned every bad request into an unhandled throw and a 500.
  let body: { rows?: unknown; mapping?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rows = body?.rows as Record<string, string>[];
  const mapping = (body?.mapping ?? {}) as Record<string, ImportTarget>;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }
  if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) {
    return NextResponse.json({ error: "Invalid column mapping" }, { status: 400 });
  }

  // Both entity types: the wizard now lets a "Mode" column route a row to
  // investment mode, so a mapped custom-field id might belong to either
  // trade or investment field definitions -- see import-wizard.tsx.
  const [tradeFieldDefinitions, investmentFieldDefinitions] = await Promise.all([
    listFieldDefinitions(supabase, "trade"),
    listFieldDefinitions(supabase, "investment"),
  ]);
  const fieldDefinitionsById = new Map(
    [...tradeFieldDefinitions, ...investmentFieldDefinitions].map((f) => [f.id, f]),
  );

  const commissionRules = await listCommissionRules(supabase);

  const toInsert: Record<string, unknown>[] = [];
  const rowErrors: { row: number; message: string }[] = [];

  rows.forEach((row, index) => {
    const result = buildRowFromMapping(row, mapping, fieldDefinitionsById);
    if (result.error) {
      if (!result.core.ticker) {
        // No ticker to anchor the row to -- skipped entirely, not inserted.
        rowErrors.push({ row: index + 1, message: `skipped: ${result.error}` });
        return;
      }
      // Still has a ticker, so it's inserted below with whatever parsed
      // cleanly (see buildRowFromMapping's doc comment) -- say so
      // explicitly, otherwise this reads as "row failed" and a user who
      // fixes the source file and re-imports ends up double-importing it.
      rowErrors.push({ row: index + 1, message: `imported with issues: ${result.error}` });
    }

    // Three passes, because these depend on each other in a cycle:
    // status is inferred partly from whether a P/L exists, the commission
    // owed depends on status (an open position hasn't paid an exit fee),
    // and the final P/L is net of that commission. So: derive a
    // provisional P/L to settle status, price the commission against it,
    // then recompute P/L (and re-derive `result`, which reads the sign of
    // the *net* number -- a thin win that fees turn into a loss should
    // import as a loss).
    const provisional = withDerivedFields(result.core);
    const provisionalStatus = deriveStatusAndResult(result.core, provisional);
    // A commission column mapped in the source file always wins over the
    // rules -- it's the broker's own number for this specific fill.
    const mapped = result.core.commission;
    const isMapped = mapped != null && Number.isFinite(Number(mapped));
    const commission = isMapped
      ? Number(mapped)
      : resolveCommission(commissionRules, {
          mode: (result.core.mode as string) ?? "trade",
          asset_type: (result.core.asset_type as string) ?? null,
          market: (result.core.market as string) ?? null,
          status: provisionalStatus.status,
          direction: (result.core.direction as string) ?? null,
          entry_price: (result.core.entry_price as number) ?? null,
          exit_price: (result.core.exit_price as number) ?? null,
          shares: (result.core.shares as number) ?? null,
        });

    const withDerived = withDerivedFields(result.core, commission);
    toInsert.push({
      user_id: userId,
      mode: "trade",
      ...withDerived,
      commission,
      commission_manual: isMapped,
      ...deriveStatusAndResult(result.core, withDerived),
      custom_fields: result.custom_fields,
    });
  });

  let imported = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase.from("trades").insert(batch, { count: "exact" });
    if (error) {
      rowErrors.push({ row: -1, message: `batch insert failed: ${error.message}` });
      continue;
    }
    imported += count ?? batch.length;
  }

  void logEvent(supabase, userId, SERVER_SESSION_ID, "import_used", {
    imported,
    errors: rowErrors.length,
  });
  return NextResponse.json({ imported, errors: rowErrors });
}
