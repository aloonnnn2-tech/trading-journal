import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { FieldDefinition } from "@/lib/fields/types";
import { EXPORT_CORE_COLUMNS } from "./export-import-fields";
import type { Trade } from "./types";

export type ExportFormat = "csv" | "xlsx" | "json";

// Flattens a trade into a single row object: core columns first, then one
// column per known custom field key (by label, so exports stay readable),
// covering both trade- and investment-entity fields since a journal can
// contain a mix of both.
export function tradeToRow(
  trade: Trade,
  fieldDefinitions: FieldDefinition[],
): Record<string, string | number | boolean | null> {
  const row: Record<string, string | number | boolean | null> = {};

  for (const column of EXPORT_CORE_COLUMNS) {
    const value = trade[column as keyof Trade];
    row[column] = value === undefined ? null : (value as string | number | boolean | null);
  }

  for (const field of fieldDefinitions) {
    const value = trade.custom_fields[field.key];
    row[field.label] = Array.isArray(value)
      ? value.join("; ")
      : ((value as string | number | boolean | null | undefined) ?? null);
  }

  return row;
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  return Papa.unparse(rows);
}

export async function rowsToXlsxBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Trades");

  if (rows.length > 0) {
    sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key }));
    sheet.addRows(rows);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function contentTypeFor(format: ExportFormat): string {
  switch (format) {
    case "csv":
      return "text/csv";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "json":
      return "application/json";
  }
}
