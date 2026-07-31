import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deriveStatusAndResult, withDerivedFields } from "@/lib/trades/import";
import { EDITABLE_CORE_FIELDS } from "@/lib/trades/types";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";
import { listCommissionRules } from "@/lib/commissions/queries";
import { resolveCommission } from "@/lib/commissions/calculate";

const BATCH_SIZE = 500;

// Direct re-import of our own JSON export format: rows already use core
// field names as keys, so no column-mapping step is needed -- just
// whitelist known columns and recompute derived fields server-side.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rows = body?.rows as Record<string, unknown>[];

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
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
      user_id: userData.user.id,
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
      errors.push({ row: -1, message: `batch insert failed: ${error.message}` });
      continue;
    }
    imported += count ?? batch.length;
  }

  void logEvent(supabase, userData.user.id, SERVER_SESSION_ID, "import_used", {
    imported,
    errors: errors.length,
  });
  return NextResponse.json({ imported, errors });
}
