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

// Excel, LibreOffice and Google Sheets evaluate a cell as a formula when its
// text begins with =, +, -, @, or a leading tab/carriage return. A CSV is
// plain text, so that decision is made at OPEN time by the spreadsheet, not
// here -- meaning journal text the user never intended as a formula (or text
// OCR lifted out of a screenshot someone else supplied) can execute when the
// export is opened, including in whatever spreadsheet they forward it to.
// Prefixing with an apostrophe is the standard neutralizer: the spreadsheet
// treats the rest as literal text and does not display the apostrophe itself.
//
// Only strings are considered -- tradeToRow preserves native types, so every
// numeric column arrives here as a number and is passed through untouched.
// Numeric-looking strings are also left alone: "-12.5" is read as a number by
// every spreadsheet, so escaping it would corrupt the value to guard against
// nothing.
//
// xlsx deliberately does not get this treatment: ExcelJS writes these values
// as typed string cells, which Excel renders literally rather than evaluating.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function neutralizeFormula(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return value;
  if (!FORMULA_TRIGGER.test(value) || PLAIN_NUMBER.test(value)) return value;
  return `'${value}`;
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  const safe = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) out[key] = neutralizeFormula(value);
    return out;
  });
  return Papa.unparse(safe);
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
