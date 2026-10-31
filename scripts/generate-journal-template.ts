// Generates public/Swing-Trading-Journal-Template.xlsx, the free download on
// /how-to-journal-a-swing-trade. Run with `npm run template:journal` and
// commit the result; the file is static, this script only makes it
// reproducible.
//
// Row 2 is the guide's worked example and must keep its numbers: entry
// 50.40, stop 48.00, 41 shares, target 55.20, exit 54.60 -> risk $98.40,
// P/L +$172.20, 1.75R. The formulas work it out, so a wrong number here
// shows up as a wrong figure the moment the file is opened.

import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "Swing-Trading-Journal-Template.xlsx",
);

/** Rows with formulas ready to fill, after the example. */
const BLANK_ROWS = 200;

const COLUMNS: { header: string; key: string; width: number; numFmt?: string; help: string }[] = [
  { header: "Date", key: "date", width: 12, numFmt: "yyyy-mm-dd", help: "The day you entered." },
  { header: "Ticker", key: "ticker", width: 10, help: "The symbol." },
  { header: "Long/Short", key: "direction", width: 11, help: "Pick Long or Short from the list." },
  { header: "Setup", key: "setup", width: 26, help: "The pattern, named the same way every time so trades can be grouped." },
  { header: "Entry", key: "entry", width: 10, numFmt: "0.00", help: "Your entry price." },
  { header: "Stop", key: "stop", width: 10, numFmt: "0.00", help: "Where the idea is proven wrong." },
  { header: "Target", key: "target", width: 10, numFmt: "0.00", help: "Optional. Where you plan to take profit." },
  { header: "Shares", key: "shares", width: 9, numFmt: "0", help: "Size it from your risk: (account × risk %) ÷ (entry − stop), rounded down." },
  { header: "Risk $ (1R)", key: "risk", width: 12, numFmt: '"$"#,##0.00', help: "Worked out: |entry − stop| × shares." },
  { header: "Planned R:R", key: "plannedRR", width: 12, numFmt: '0.00"R"', help: "Worked out: how many R the target is worth." },
  { header: "Exit", key: "exit", width: 10, numFmt: "0.00", help: "Your exit price. Leave empty while the trade is open." },
  { header: "Fees $", key: "fees", width: 9, numFmt: '"$"#,##0.00', help: "Commissions and fees for the round trip. Optional." },
  { header: "P/L $", key: "pl", width: 12, numFmt: '"$"#,##0.00;[Red]-"$"#,##0.00', help: "Worked out: (exit − entry) × shares, flipped for shorts, minus fees." },
  { header: "R multiple", key: "r", width: 11, numFmt: '0.00"R";[Red]-0.00"R"', help: "Worked out: P/L ÷ Risk $." },
  { header: "Followed plan?", key: "followed", width: 15, help: "Yes, No or Partly. A loss that followed the plan is a good trade." },
  { header: "Feeling before", key: "feelingBefore", width: 16, help: "One word: calm, impatient, chasing, bored." },
  { header: "Feeling after", key: "feelingAfter", width: 16, help: "One word." },
  { header: "Plan (why now)", key: "plan", width: 40, help: "Written BEFORE entry: what you see and what would make you wrong." },
  { header: "Notes during", key: "during", width: 40, help: "Every change while open, with the reason: stop moves, partial sells, news." },
  { header: "Review and lesson", key: "lesson", width: 44, help: "What went right, what went wrong, and one thing to do next time." },
];

// Column letters for the formulas, from the order above.
const col = (key: string) => String.fromCharCode(65 + COLUMNS.findIndex((c) => c.key === key));
const [E, F, G, H, I, K, L, M, C] = ["entry", "stop", "target", "shares", "risk", "exit", "fees", "pl", "direction"].map(col);

function formulas(row: number) {
  return {
    risk: { formula: `IF(OR(${E}${row}="",${F}${row}="",${H}${row}=""),"",ABS(${E}${row}-${F}${row})*${H}${row})` },
    plannedRR: {
      formula: `IF(OR(${G}${row}="",${E}${row}="",${F}${row}="",${E}${row}=${F}${row}),"",(${G}${row}-${E}${row})/(${E}${row}-${F}${row}))`,
    },
    pl: {
      formula: `IF(OR(${K}${row}="",${E}${row}="",${H}${row}=""),"",(${K}${row}-${E}${row})*${H}${row}*IF(${C}${row}="Short",-1,1)-N(${L}${row}))`,
    },
    r: { formula: `IF(OR(${M}${row}="",${I}${row}="",${I}${row}=0),"",${M}${row}/${I}${row})` },
  };
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Trading Lens";
  wb.title = "Swing Trading Journal";
  // exceljs writes formulas without computed values; this makes Excel and
  // LibreOffice work them out on open instead of showing blanks.
  wb.calcProperties.fullCalcOnLoad = true;

  const ws = wb.addWorksheet("Journal", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  ws.columns = COLUMNS.map(({ header, key, width, numFmt }) => ({
    header,
    key,
    width,
    style: numFmt ? { numFmt } : {},
  }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;

  // Row 2: the guide's worked example. Made-up ticker and numbers.
  const example = formulas(2);
  ws.addRow({
    date: "Example",
    ticker: "XYZ",
    direction: "Long",
    setup: "Breakout from a 3-week base",
    entry: 50.4,
    stop: 48,
    target: 55.2,
    shares: 41,
    exit: 54.6,
    fees: 0,
    followed: "Partly",
    feelingBefore: "Calm, a little eager",
    feelingAfter: "Pleased, but sold early",
    plan: "Closed above the range on rising volume. Wrong if it closes back under 48.",
    during: "Day 2: pulled back to 49.60, held. Day 4: 53.90, stop left at 48. Day 6: hit 55.00, sold at 54.60.",
    lesson: "Entry, stop and size followed the plan; the exit did not. Next time: write the reason before exiting early.",
    // Cached results too, for previewers that never recalculate (a mail
    // client's or a file browser's quick look).
    risk: { ...example.risk, result: 98.4 },
    plannedRR: { ...example.plannedRR, result: 2 },
    pl: { ...example.pl, result: 172.2 },
    r: { ...example.r, result: 1.75 },
  });
  ws.getRow(2).font = { italic: true, color: { argb: "FF52525B" } };

  for (let row = 3; row < 3 + BLANK_ROWS; row++) ws.addRow(formulas(row));

  const last = 2 + BLANK_ROWS;
  for (let row = 2; row <= last; row++) {
    ws.getCell(`${C}${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Long,Short"'],
    };
    ws.getCell(`${col("followed")}${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Yes,No,Partly"'],
    };
  }
  // The worked-out columns are shaded so nobody types over a formula.
  for (const key of ["risk", "plannedRR", "pl", "r"]) {
    for (let row = 2; row <= last; row++) {
      ws.getCell(`${col(key)}${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    }
  }

  const help = wb.addWorksheet("How to use");
  help.columns = [
    { header: "Column", key: "column", width: 20 },
    { header: "What to write", key: "what", width: 90 },
  ];
  help.getRow(1).font = { bold: true };
  help.addRows([
    { column: "Swing Trading Journal", what: "From the guide at https://tradinglenz.netlify.app/how-to-journal-a-swing-trade" },
    { column: "", what: "Fill in the plan columns BEFORE you enter. Shaded columns are worked out for you." },
    { column: "", what: "Row 2 is a made-up example to show the format. Delete it when you start." },
    { column: "", what: "" },
    ...COLUMNS.map((c) => ({ column: c.header, what: c.help })),
    { column: "", what: "" },
    { column: "", what: "A trading journal and education tool. Not financial advice." },
  ]);
  help.getColumn("what").alignment = { wrapText: true, vertical: "top" };

  await wb.xlsx.writeFile(OUT);
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
