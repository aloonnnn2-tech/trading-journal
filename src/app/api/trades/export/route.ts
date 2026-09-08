import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { listAllTradeFolderLinks } from "@/lib/folders/queries";
import { listTrades } from "@/lib/trades/queries";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  contentTypeFor,
  rowsToCsv,
  rowsToXlsxBuffer,
  tradeToRow,
  type ExportFormat,
} from "@/lib/trades/export";

export async function GET(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Serialises the account's entire trade history in one response. Cheap for
  // a user with fifty trades, not cheap for one with twenty thousand, and
  // looping it is an easy way to burn both database time and bandwidth.
  const limited = enforceRateLimit(
    `export:${userId}`,
    20,
    60_000,
    "Too many exports in a row. Wait a moment and try again.",
  );
  if (limited) return limited;

  const supabase = await createClient();

  const url = new URL(request.url);
  // Whitelist rather than cast: the cast let arbitrary query input reach
  // contentTypeFor (whose switch has no runtime default) and flow raw into
  // the Content-Disposition filename header.
  const requested = url.searchParams.get("format") ?? "csv";
  const VALID_FORMATS: readonly ExportFormat[] = ["csv", "xlsx", "json"];
  if (!VALID_FORMATS.includes(requested as ExportFormat)) {
    return NextResponse.json({ error: "Unknown format — use csv, xlsx, or json" }, { status: 400 });
  }
  const format = requested as ExportFormat;
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
