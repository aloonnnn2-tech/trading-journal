// Generates a small set of synthetic broker-style screenshots with known
// ground truth, so `npm run ocr:eval` has something to score out of the box.
// These exercise the pipeline plumbing and semantic logic (light + dark,
// same-line + arrow notation, tables). Drop real broker screenshots alongside
// them (any <name>.png + <name>.expected.json) to grow the suite toward the
// 100/500/1000-image targets in the spec.

import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

interface Fixture {
  name: string;
  category: string;
  width: number;
  height: number;
  bg: string;
  fg: string;
  lines: { x: number; y: number; size: number; text: string; fill?: string }[];
  expected: Record<string, unknown>;
}

const FIXTURES: Fixture[] = [
  {
    name: "light-order-ticket",
    category: "stocks",
    width: 560,
    height: 360,
    bg: "#ffffff",
    fg: "#111827",
    lines: [
      { x: 30, y: 50, size: 30, text: "NASDAQ:AAPL" },
      { x: 30, y: 100, size: 24, text: "Buy  Market" },
      { x: 30, y: 145, size: 24, text: "Entry Price   150.25" },
      { x: 30, y: 190, size: 24, text: "Stop Loss   147.80", fill: "#dc2626" },
      { x: 30, y: 235, size: 24, text: "Take Profit   158.40", fill: "#16a34a" },
      { x: 30, y: 280, size: 24, text: "Quantity   100" },
      { x: 30, y: 325, size: 24, text: "Position Size   15025.00" },
    ],
    expected: {
      ticker: "AAPL",
      direction: "long",
      entry_price: 150.25,
      stop_loss: 147.8,
      take_profit: 158.4,
      shares: 100,
      position_size: 15025.0,
    },
  },
  {
    name: "dark-open-position",
    category: "stocks",
    width: 560,
    height: 340,
    bg: "#131722",
    fg: "#d1d4dc",
    lines: [
      { x: 30, y: 50, size: 30, text: "TSLA  Short" },
      { x: 30, y: 100, size: 24, text: "Avg Entry   242.10" },
      { x: 30, y: 145, size: 24, text: "Mark Price   238.65" },
      { x: 30, y: 190, size: 24, text: "Qty   50 shares" },
      { x: 30, y: 235, size: 24, text: "Unrealized PnL   172.50", fill: "#16a34a" },
      { x: 30, y: 280, size: 24, text: "Status   Open" },
    ],
    expected: {
      ticker: "TSLA",
      direction: "short",
      entry_price: 242.1,
      current_price: 238.65,
      shares: 50,
      status: "open",
    },
  },
  {
    name: "mt5-buy",
    category: "forex",
    width: 560,
    height: 300,
    bg: "#f4f4f5",
    fg: "#18181b",
    lines: [
      { x: 30, y: 50, size: 28, text: "EURUSD, buy 0.50" },
      { x: 30, y: 100, size: 24, text: "1.08432 -> 1.09105" },
      { x: 30, y: 145, size: 24, text: "S / L   1.08100" },
      { x: 30, y: 190, size: 24, text: "T / P   1.09800" },
      { x: 30, y: 235, size: 24, text: "Profit   336.50", fill: "#16a34a" },
    ],
    expected: {
      ticker: "EURUSD",
      direction: "long",
      entry_price: 1.08432,
      stop_loss: 1.081,
      take_profit: 1.098,
      shares: 0.5,
    },
  },
  {
    name: "crypto-position",
    category: "crypto",
    width: 560,
    height: 300,
    bg: "#0b0e11",
    fg: "#eaecef",
    lines: [
      { x: 30, y: 50, size: 28, text: "BINANCE:BTCUSDT  Long" },
      { x: 30, y: 100, size: 24, text: "Entry Price   61250.00" },
      { x: 30, y: 145, size: 24, text: "Stop Loss   59800.00", fill: "#f6465d" },
      { x: 30, y: 190, size: 24, text: "Take Profit   64200.00", fill: "#0ecb81" },
      { x: 30, y: 235, size: 24, text: "Size   0.25" },
    ],
    expected: {
      ticker: "BTCUSDT",
      direction: "long",
      entry_price: 61250.0,
      stop_loss: 59800.0,
      take_profit: 64200.0,
      shares: 0.25,
    },
  },
  {
    // Exercises a different vocabulary set than the other fixtures — proves
    // the expanded label dictionary (protective stop, profit target, buy
    // price, filled qty, position opened) resolves, not just the originals.
    name: "webull-style-buy",
    category: "stocks",
    width: 560,
    height: 380,
    bg: "#ffffff",
    fg: "#1a1a1a",
    lines: [
      { x: 30, y: 50, size: 30, text: "NYSE:MSFT" },
      { x: 30, y: 100, size: 24, text: "Buy Price   412.50" },
      { x: 30, y: 145, size: 24, text: "Protective Stop   398.00", fill: "#dc2626" },
      { x: 30, y: 190, size: 24, text: "Profit Target   440.00", fill: "#16a34a" },
      { x: 30, y: 235, size: 24, text: "Filled Qty   25" },
      { x: 30, y: 280, size: 24, text: "Notional   10312.50" },
      { x: 30, y: 325, size: 24, text: "Position Opened   2026-06-01" },
    ],
    expected: {
      ticker: "MSFT",
      direction: "long",
      entry_price: 412.5,
      stop_loss: 398.0,
      take_profit: 440.0,
      shares: 25,
      position_size: 10312.5,
      entry_date: "2026-06-01",
    },
  },
  {
    // Futures/Tradovate-style vocabulary: exec price, hard stop, reward
    // target, contracts, floating p/l.
    name: "futures-style-short",
    category: "futures",
    width: 560,
    height: 320,
    bg: "#0f1115",
    fg: "#e5e5e5",
    lines: [
      { x: 30, y: 50, size: 28, text: "CME:ES  Sell" },
      { x: 30, y: 100, size: 24, text: "Exec Price   5320.25" },
      { x: 30, y: 145, size: 24, text: "Hard Stop   5335.50", fill: "#f6465d" },
      { x: 30, y: 190, size: 24, text: "Reward Target   5290.00", fill: "#0ecb81" },
      { x: 30, y: 235, size: 24, text: "Contracts   2" },
      { x: 30, y: 280, size: 24, text: "Floating P/L   200.00", fill: "#0ecb81" },
    ],
    expected: {
      ticker: "ES",
      direction: "short",
      entry_price: 5320.25,
      stop_loss: 5335.5,
      take_profit: 5290.0,
      shares: 2,
    },
  },
  {
    // Mirrors a real TradingView Stop-order ticket that broke entry_price:
    // the order price is labeled with nothing but a bare "Price", stacked
    // above its value rather than same-line, plus a two-sided "Sell X / Buy
    // Y" quote row that must NOT be read as the trade's direction, and
    // "Take profit, price" / "Stop loss, price" comma-suffixed labels.
    name: "stop-order-bare-price",
    category: "stocks",
    width: 300,
    height: 460,
    bg: "#131722",
    fg: "#d1d4dc",
    lines: [
      { x: 20, y: 30, size: 20, text: "USB" },
      { x: 20, y: 65, size: 18, text: "Sell 61.73    0.00    Buy 61.73" },
      { x: 20, y: 100, size: 16, text: "Market  Limit  Stop  Stop Limit" },
      { x: 20, y: 135, size: 16, text: "Price" },
      { x: 20, y: 165, size: 20, text: "61.73" },
      { x: 20, y: 205, size: 16, text: "Shares" },
      { x: 20, y: 235, size: 26, text: "1" },
      { x: 20, y: 270, size: 16, text: "Take profit, price" },
      { x: 20, y: 300, size: 20, text: "86.31", fill: "#0ecb81" },
      { x: 20, y: 340, size: 16, text: "Stop loss, price" },
      { x: 20, y: 370, size: 20, text: "59.52", fill: "#f6465d" },
    ],
    expected: {
      ticker: "USB",
      entry_price: 61.73,
      shares: 1,
      take_profit: 86.31,
      stop_loss: 59.52,
    },
  },
];

function toSvg(f: Fixture): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const texts = f.lines
    .map(
      (l) =>
        `<text x="${l.x}" y="${l.y}" font-family="Arial, Helvetica, sans-serif" font-size="${l.size}" fill="${l.fill ?? f.fg}">${escape(l.text)}</text>`,
    )
    .join("\n");
  return `<svg width="${f.width}" height="${f.height}" xmlns="http://www.w3.org/2000/svg"><rect width="${f.width}" height="${f.height}" fill="${f.bg}"/>${texts}</svg>`;
}

async function main() {
  for (const f of FIXTURES) {
    const dir = path.join(DIR, f.category);
    await fs.mkdir(dir, { recursive: true });
    const png = path.join(dir, `${f.name}.png`);
    const expected = path.join(dir, `${f.name}.expected.json`);
    await sharp(Buffer.from(toSvg(f))).png().toFile(png);
    await fs.writeFile(expected, JSON.stringify({ core: f.expected }, null, 2));
    console.log(`wrote ${path.relative(process.cwd(), png)}`);
  }
  console.log(`\n${FIXTURES.length} fixtures generated in ${path.relative(process.cwd(), DIR)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
