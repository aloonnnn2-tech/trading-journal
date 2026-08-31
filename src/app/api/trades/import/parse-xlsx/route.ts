import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB, same cap as the image upload route

// An .xlsx IS a zip archive, so MAX_BYTES bounds the COMPRESSED size only.
// Highly repetitive sheet XML compresses at extreme ratios, so a few MB can
// describe hundreds of millions of cells -- a decompression bomb. The caps
// below bound what this route will hold in memory and hand back as JSON. A
// real broker export is a few thousand rows; 20k leaves generous room.
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 200;
// Header text becomes a JSON key echoed back to the client and used as a
// mapping key, so it needs its own bound -- a sheet can carry megabytes in a
// single cell.
const MAX_HEADER_LENGTH = 200;
// Same reasoning for cell values: the response is built entirely from
// attacker-controlled text.
const MAX_CELL_LENGTH = 10_000;

// The first bytes of every zip archive, and therefore of every .xlsx. Checked
// before handing the buffer to ExcelJS so obviously-wrong input is refused by
// this route with a clear 400 rather than inside the parser.
const ZIP_MAGIC = [0x50, 0x4b];

function cell(value: unknown, max: number): string {
  if (value === undefined || value === null) return "";
  // Rich text and formula cells deserialize to objects; String() on those
  // yields "[object Object]", so pull the readable text where ExcelJS
  // provides it and fall back to empty rather than leaking a shape.
  if (typeof value === "object") {
    const o = value as { text?: unknown; result?: unknown; richText?: { text?: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r?.text ?? "").join("").slice(0, max);
    if (typeof o.text === "string") return o.text.slice(0, max);
    if (o.result !== undefined && typeof o.result !== "object") return String(o.result).slice(0, max);
    if (value instanceof Date) return value.toISOString();
    return "";
  }
  return String(value).slice(0, max);
}

export async function POST(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 5 MB limit" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.length < 2 || buffer[0] !== ZIP_MAGIC[0] || buffer[1] !== ZIP_MAGIC[1]) {
    return NextResponse.json(
      { error: "That file isn't an Excel workbook (.xlsx)." },
      { status: 400 },
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch {
    return NextResponse.json({ error: "Could not read this file as an Excel workbook" }, { status: 400 });
  }
  const sheet = workbook.worksheets[0];

  if (!sheet) {
    return NextResponse.json({ headers: [], rows: [] });
  }

  const headerRow = sheet.getRow(1);
  const headers = (headerRow.values as unknown[])
    .slice(1, MAX_COLUMNS + 1)
    .map((v) => cell(v, MAX_HEADER_LENGTH));

  const rows: Record<string, string>[] = [];
  let truncated = false;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    // eachRow has no early exit, so the cap is enforced by skipping rather
    // than breaking -- without it a bombed sheet builds an unbounded array
    // here even though the file itself passed the byte check.
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      return;
    }
    const values = (row.values as unknown[]).slice(1, MAX_COLUMNS + 1);
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = cell(values[i], MAX_CELL_LENGTH);
    });
    rows.push(record);
  });

  // Reported rather than silently dropped: an import that quietly stops at row
  // 20,000 looks like successful data loss.
  return NextResponse.json({
    headers,
    rows,
    ...(truncated ? { truncated: true, maxRows: MAX_ROWS } : {}),
  });
}
