import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { deriveStatusAndResult, withDerivedFields } from "@/lib/trades/import";
import { EDITABLE_CORE_FIELDS } from "@/lib/trades/types";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { listCommissionRules } from "@/lib/commissions/queries";
import { resolveCommission } from "@/lib/commissions/calculate";
import { enforceRateLimit } from "@/lib/rate-limit";

const BATCH_SIZE = 500;

// Bounds the JSON body: the rows array arrives straight from the client with
// no limit of its own, so without this one request can hold an unbounded
// array in memory and fan out into hundreds of batched inserts. Matches the
// xlsx parser's ceiling so the two halves of an import agree.
const MAX_ROWS = 20_000;

const importJsonBodySchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS),
});

// Direct re-import of our own JSON export format: rows already use core
// field names as keys, so no column-mapping step is needed -- just
// whitelist known columns and recompute derived fields server-side.
export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same budget and the same reasoning as the mapped-CSV import: this is the
  // other half of the same feature and writes to the same tables.
  const limited = enforceRateLimit(
    `import:${userId}`,
    10,
    60_000,
    "Too many imports in a row. Wait a minute, then try again -- rows already imported were saved.",
  );
  if (limited) return limited;

  const supabase = await createClient();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // `rows` was checked only for being a non-empty array, leaving each element
  // unchecked -- and the loop below reads `row.ticker` straight away, so a
  // null element threw a TypeError and turned the whole request into a 500
  // that imported nothing. Each row must be an object; its values stay
  // `unknown` because this endpoint deliberately re-imports our own export
  // shape, where they are already typed (numbers, strings, nested
  // custom_fields) rather than spreadsheet text.
  const parsed = importJsonBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid import body${issue ? `: ${issue.path.join(".")} ${issue.message}` : ""}` },
      { status: 400 },
    );
  }
  const rows = parsed.data.rows;

  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows — import at most ${MAX_ROWS.toLocaleString()} at a time.` },
      { status: 413 },
    );
  }

  const commissionRules = await listCommissionRules(supabase);

  const errors: { row: number; message: string }[] = [];
  const toInsert: Record<string, unknown>[] = [];

  rows.forEach((row, index) => {
    if (!row.ticker) {
      errors.push({ row: index + 1, message: "missing ticker" });
      return;
    }
    const core: Record<string, unknown> = {};
    for (const key of EDITABLE_CORE_FIELDS) {
      if (row[key] !== undefined) core[key] = row[key];
    }
    // A JSON export round-trip carries the commission it was exported with,
    // so it's preserved verbatim (and pinned) rather than re-priced against
    // whatever rules happen to exist now -- re-importing your own backup
    // shouldn't silently restate its P&L. Rows without one fall back to the
    // rules, same as a fresh CSV import.
    const exported = core.commission;
    const hasExported = exported != null && Number.isFinite(Number(exported));
    let commission: number | null = hasExported ? Number(exported) : null;
    if (!hasExported) {
      const provisional = withDerivedFields(core);
      const provisionalStatus = deriveStatusAndResult(core, provisional);
      commission = resolveCommission(commissionRules, {
        mode: (core.mode as string) ?? "trade",
        asset_type: (core.asset_type as string) ?? null,
        market: (core.market as string) ?? null,
        status: provisionalStatus.status,
        direction: (core.direction as string) ?? null,
        entry_price: (core.entry_price as number) ?? null,
        exit_price: (core.exit_price as number) ?? null,
        shares: (core.shares as number) ?? null,
      });
    }

    const withDerived = withDerivedFields(core, commission);
    toInsert.push({
      user_id: userId,
      mode: core.mode ?? "trade",
      ...withDerived,
      commission,
      commission_manual: hasExported,
      ...deriveStatusAndResult(core, withDerived),
      custom_fields: (row.custom_fields as Record<string, unknown>) ?? {},
    });
  });

  let imported = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase.from("trades").insert(batch, { count: "exact" });
    if (error) {
      console.error("[import-json] batch insert failed:", error);
      errors.push({ row: -1, message: "batch insert failed" });
      continue;
    }
    imported += count ?? batch.length;
  }

  void logEvent(supabase, userId, SERVER_SESSION_ID, "import_used", {
    imported,
    errors: errors.length,
  });
  return NextResponse.json({ imported, errors });
}
