import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { listAllTradeFolderLinks } from "@/lib/folders/queries";
import { listTrades } from "@/lib/trades/queries";
import {
  contentTypeFor,
  rowsToCsv,
  rowsToXlsxBuffer,
  tradeToRow,
  type ExportFormat,
} from "@/lib/trades/export";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "csv") as ExportFormat;
  const folderId = url.searchParams.get("folder");

  let trades = await listTrades(supabase);
  if (folderId) {
    const links = await listAllTradeFolderLinks(supabase);
    trades = trades.filter((trade) => links[trade.id]?.includes(folderId));
  }

  const filename = `trades-export.${format}`;

  // JSON keeps the raw trade shape (custom_fields nested) so it round-trips
  // cleanly through /api/trades/import-json. CSV/XLSX flatten custom
  // fields into labeled columns since they're for spreadsheet use, not
  // re-import fidelity.
  let body: string | Buffer;
  if (format === "json") {
    body = JSON.stringify(trades, null, 2);
  } else {
    const tradeFields = await listFieldDefinitions(supabase, "trade");
    const investmentFields = await listFieldDefinitions(supabase, "investment");
    const allFields = [...tradeFields, ...investmentFields];
    const rows = trades.map((trade) => tradeToRow(trade, allFields));
    body = format === "xlsx" ? await rowsToXlsxBuffer(rows) : rowsToCsv(rows);
  }

  return new NextResponse(body as BodyInit, {
    headers: {
      "Content-Type": contentTypeFor(format),
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
