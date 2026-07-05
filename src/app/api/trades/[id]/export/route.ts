import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const trade = await getTrade(supabase, id);
  if (!trade) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "json") as ExportFormat;
  const filename = `trade-${trade.ticker || trade.id}.${format}`;

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
