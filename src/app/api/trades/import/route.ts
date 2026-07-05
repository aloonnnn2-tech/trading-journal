import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { buildRowFromMapping, withDerivedFields, type ImportTarget } from "@/lib/trades/import";

const BATCH_SIZE = 500;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const rows = body.rows as Record<string, string>[];
  const mapping = body.mapping as Record<string, ImportTarget>;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }

  const fieldDefinitions = await listFieldDefinitions(supabase, "trade");
  const fieldDefinitionsById = new Map(fieldDefinitions.map((f) => [f.id, f]));

  const toInsert: Record<string, unknown>[] = [];
  const rowErrors: { row: number; message: string }[] = [];

  rows.forEach((row, index) => {
    const result = buildRowFromMapping(row, mapping, fieldDefinitionsById);
    if (result.error) {
      rowErrors.push({ row: index + 1, message: result.error });
      if (!result.core.ticker) return; // skip rows with no ticker entirely
    }

    toInsert.push({
      user_id: userData.user.id,
      mode: "trade",
      status: "closed",
      result: "open",
      ...withDerivedFields(result.core),
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

  return NextResponse.json({ imported, errors: rowErrors });
}
