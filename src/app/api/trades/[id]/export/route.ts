import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { getTrade } from "@/lib/trades/queries";
import {
  contentTypeFor,
  rowsToCsv,
  rowsToXlsxBuffer,
  tradeToRow,
  type ExportFormat,
} from "@/lib/trades/export";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const trade = await getTrade(supabase, id);
  if (!trade) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  // Whitelisted, not cast -- and the ticker is user-typed text, so it's
  // stripped to filename-safe characters before entering the
  // Content-Disposition header.
  const requested = url.searchParams.get("format") ?? "json";
  const VALID_FORMATS: readonly ExportFormat[] = ["csv", "xlsx", "json"];
  if (!VALID_FORMATS.includes(requested as ExportFormat)) {
    return NextResponse.json({ error: "Unknown format — use csv, xlsx, or json" }, { status: 400 });
  }
  const format = requested as ExportFormat;
  const safeTicker = (trade.ticker || trade.id).replace(/[^A-Za-z0-9._-]/g, "_");
  const filename = `trade-${safeTicker}.${format}`;

  let body: string | Buffer;
  if (format === "json") {
    body = JSON.stringify(trade, null, 2);
  } else {
    const fieldDefinitions = await listFieldDefinitions(supabase, trade.mode);
    const row = tradeToRow(trade, fieldDefinitions);
    body = format === "xlsx" ? await rowsToXlsxBuffer([row]) : rowsToCsv([row]);
  }

  return new NextResponse(body as BodyInit, {
    headers: {
      "Content-Type": contentTypeFor(format),
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
