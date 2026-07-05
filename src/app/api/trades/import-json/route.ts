import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withDerivedFields } from "@/lib/trades/import";
import { EDITABLE_CORE_FIELDS } from "@/lib/trades/types";

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

  const body = await request.json();
  const rows = body.rows as Record<string, unknown>[];

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }

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
    toInsert.push({
      user_id: userData.user.id,
      mode: core.mode ?? "trade",
      status: core.status ?? "closed",
      result: core.result ?? "open",
      ...withDerivedFields(core),
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

  return NextResponse.json({ imported, errors });
}
