import { NextResponse } from "next/server";
import { z } from "zod";
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

// Bounds the JSON body: the rows array arrives straight from the client with
// no limit of its own, so without this one request can hold an unbounded
// array in memory and fan out into hundreds of batched inserts. Matches the
// xlsx parser's ceiling so the two halves of an import agree.
const MAX_ROWS = 20_000;

// Spreadsheet cells arrive as strings from both producers (papaparse for CSV,
// and the xlsx route, which stringifies every cell). Numbers and booleans are
// coerced rather than rejected so a hand-rolled client still works, while
// objects, arrays and nulls -- the shapes that made raw.trim() throw -- are
// refused with a 400 that names the offending path.
const cellValue = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .transform((v) => (v == null ? "" : String(v)));

const importBodySchema = z.object({
  rows: z.array(z.record(z.string(), cellValue)).max(MAX_ROWS),
  // Values are column targets ("ignore", a core field name, or "custom:<id>").
  // buildRowFromMapping calls .startsWith on them, so they must be strings;
  // an unrecognised one is already reported per-row as a column error.
  mapping: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // A malformed body is a client mistake, not a server fault -- parsing it
  // unguarded turned every bad request into an unhandled throw and a 500.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // The shape checks used to stop at "rows is a non-empty array" and "mapping
  // is an object", which left everything inside them unchecked -- and
  // buildRowFromMapping indexes both. Measured against the real function, a
  // null row, a non-string cell value, and a non-string mapping target each
  // threw a TypeError, which surfaces here as a 500 that abandons the whole
  // import, valid rows included.
  const parsed = importBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid import body${issue ? `: ${issue.path.join(".")} ${issue.message}` : ""}` },
      { status: 400 },
    );
  }

  const rows = parsed.data.rows;
  const mapping = (parsed.data.mapping ?? {}) as Record<string, ImportTarget>;

  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows — import at most ${MAX_ROWS.toLocaleString()} at a time.` },
      { status: 413 },
    );
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
      console.error("[import] batch insert failed:", error);
      rowErrors.push({ row: -1, message: "batch insert failed" });
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
