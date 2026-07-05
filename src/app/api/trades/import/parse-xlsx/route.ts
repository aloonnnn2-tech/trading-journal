import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];

  if (!sheet) {
    return NextResponse.json({ headers: [], rows: [] });
  }

  const headerRow = sheet.getRow(1);
  const headers = (headerRow.values as unknown[]).slice(1).map((v) => String(v ?? ""));

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = (row.values as unknown[]).slice(1);
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = values[i] === undefined || values[i] === null ? "" : String(values[i]);
    });
    rows.push(record);
  });

  return NextResponse.json({ headers, rows });
}
